const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// ==================== إنشاء المجلدات تلقائياً ====================
const folders = [
    'database',
    'uploads',
    'uploads/images',
    'uploads/files',
    'uploads/voices',
    'uploads/videos',
    'ringtones',
    'logs',
    'public',
    'public/css',
    'public/js'
];

console.log('📁 جاري إنشاء المجلدات...');
folders.forEach(folder => {
    const folderPath = path.join(__dirname, folder);
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`✅ تم إنشاء المجلد: ${folder}`);
    }
});

// ==================== إنشاء ملف قاعدة البيانات ====================
const dbPath = path.join(__dirname, 'database', 'contacts.db');
let db;

function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ خطأ في فتح قاعدة البيانات:', err);
                reject(err);
                return;
            }
            console.log('✅ تم فتح قاعدة البيانات:', dbPath);
            
            // إنشاء الجداول
            db.serialize(() => {
                // جدول المستخدمين
                db.run(`
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE NOT NULL,
                        password TEXT NOT NULL,
                        phone TEXT,
                        email TEXT,
                        status TEXT DEFAULT 'offline',
                        avatar TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_seen DATETIME
                    )
                `, (err) => {
                    if (err) console.error('❌ خطأ في إنشاء جدول users:', err);
                    else console.log('✅ جدول users جاهز');
                });
                
                // جدول جهات الاتصال
                db.run(`
                    CREATE TABLE IF NOT EXISTS contacts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        contact_name TEXT NOT NULL,
                        contact_phone TEXT,
                        contact_email TEXT,
                        contact_group TEXT DEFAULT 'عام',
                        contact_notes TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id),
                        UNIQUE(user_id, contact_name)
                    )
                `, (err) => {
                    if (err) console.error('❌ خطأ في إنشاء جدول contacts:', err);
                    else console.log('✅ جدول contacts جاهز');
                });
                
                // جدول الرسائل
                db.run(`
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        from_user TEXT NOT NULL,
                        to_user TEXT NOT NULL,
                        message TEXT,
                        message_type TEXT DEFAULT 'text',
                        file_url TEXT,
                        file_name TEXT,
                        audio_url TEXT,
                        video_url TEXT,
                        duration INTEGER,
                        is_read INTEGER DEFAULT 0,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) console.error('❌ خطأ في إنشاء جدول messages:', err);
                    else console.log('✅ جدول messages جاهز');
                });
                
                // جدول المكالمات
                db.run(`
                    CREATE TABLE IF NOT EXISTS calls (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        from_user TEXT NOT NULL,
                        to_user TEXT NOT NULL,
                        call_type TEXT,
                        duration INTEGER,
                        status TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) console.error('❌ خطأ في إنشاء جدول calls:', err);
                    else console.log('✅ جدول calls جاهز');
                });
                
                // جدول الإعدادات
                db.run(`
                    CREATE TABLE IF NOT EXISTS settings (
                        user_id INTEGER PRIMARY KEY,
                        theme TEXT DEFAULT 'light',
                        ringtone TEXT DEFAULT 'default',
                        volume INTEGER DEFAULT 80,
                        vibrate INTEGER DEFAULT 1,
                        retention_days INTEGER DEFAULT 7,
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )
                `, (err) => {
                    if (err) console.error('❌ خطأ في إنشاء جدول settings:', err);
                    else console.log('✅ جدول settings جاهز');
                });
                
                // إضافة مستخدم تجريبي إذا لم يكن موجوداً
                db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
                    if (err) return;
                    if (!row) {
                        db.run(`
                            INSERT INTO users (username, password, phone, email, status) 
                            VALUES (?, ?, ?, ?, ?)
                        `, ['admin', 'admin123', '0500000000', 'admin@example.com', 'online'], (err) => {
                            if (err) console.error('❌ خطأ في إضافة المستخدم التجريبي:', err);
                            else console.log('✅ تم إضافة المستخدم التجريبي (admin/admin123)');
                        });
                    }
                });
                
                resolve();
            });
        });
    });
}

// ==================== إعدادات Express ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// إعداد الجلسات
app.use(session({
    secret: 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 ساعة
}));

// ==================== إعداد رفع الملفات ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath = path.join(__dirname, 'uploads');
        if (file.mimetype.startsWith('image/')) {
            uploadPath = path.join(uploadPath, 'images');
        } else if (file.mimetype.startsWith('video/')) {
            uploadPath = path.join(uploadPath, 'videos');
        } else if (file.mimetype.startsWith('audio/')) {
            uploadPath = path.join(uploadPath, 'voices');
        } else {
            uploadPath = path.join(uploadPath, 'files');
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB حد أقصى
});

// ==================== API Routes ====================

// تسجيل الدخول
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, user) => {
        if (err) {
            res.json({ success: false, message: 'خطأ في قاعدة البيانات' });
            return;
        }
        
        if (user) {
            // تحديث حالة المستخدم
            db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', ['online', user.id]);
            req.session.userId = user.id;
            req.session.username = user.username;
            res.json({ 
                success: true, 
                user: { 
                    id: user.id, 
                    username: user.username, 
                    phone: user.phone, 
                    email: user.email 
                } 
            });
        } else {
            res.json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
    });
});

// تسجيل مستخدم جديد
app.post('/api/register', (req, res) => {
    const { username, password, phone, email } = req.body;
    
    db.run('INSERT INTO users (username, password, phone, email, status) VALUES (?, ?, ?, ?, ?)',
        [username, password, phone || '', email || '', 'offline'],
        function(err) {
            if (err) {
                res.json({ success: false, message: 'اسم المستخدم موجود مسبقاً' });
                return;
            }
            res.json({ success: true, userId: this.lastID });
        }
    );
});

// جلب جميع المستخدمين (للبحث)
app.get('/api/all-users', (req, res) => {
    if (!req.session.userId) {
        res.json({ success: false, message: 'غير مسجل دخول' });
        return;
    }
    
    db.all('SELECT id, username, phone, email, status FROM users WHERE id != ?', [req.session.userId], (err, users) => {
        if (err) {
            res.json({ success: false, message: err.message });
            return;
        }
        res.json({ success: true, users: users || [] });
    });
});

// جلب جهات الاتصال الخاصة بالمستخدم
app.get('/get-contacts', (req, res) => {
    if (!req.session.userId) {
        res.json({ contacts: [] });
        return;
    }
    
    db.all(`
        SELECT c.*, u.status as contact_status 
        FROM contacts c
        LEFT JOIN users u ON u.username = c.contact_name
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC
    `, [req.session.userId], (err, contacts) => {
        if (err) {
            console.error('Error loading contacts:', err);
            res.json({ contacts: [] });
            return;
        }
        
        const formattedContacts = contacts.map(c => ({
            name: c.contact_name,
            phone: c.contact_phone,
            email: c.contact_email,
            group: c.contact_group,
            notes: c.contact_notes,
            status: c.contact_status || 'offline'
        }));
        
        res.json({ contacts: formattedContacts });
    });
});

// إضافة جهة اتصال
app.post('/api/add-contact', (req, res) => {
    if (!req.session.userId) {
        res.json({ success: false, message: 'غير مسجل دخول' });
        return;
    }
    
    const { name, phone, email, group, notes } = req.body;
    
    db.run(`
        INSERT OR REPLACE INTO contacts (user_id, contact_name, contact_phone, contact_email, contact_group, contact_notes)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [req.session.userId, name, phone || '', email || '', group || 'عام', notes || ''], function(err) {
        if (err) {
            console.error('Error adding contact:', err);
            res.json({ success: false, message: err.message });
            return;
        }
        res.json({ success: true, contact: { id: this.lastID, name, phone, email, group, notes } });
    });
});

// إضافة جهة اتصال متقدمة
app.post('/api/add-contact-advanced', (req, res) => {
    if (!req.session.userId) {
        res.json({ success: false, message: 'غير مسجل دخول' });
        return;
    }
    
    const { name, phone, email, group, notes } = req.body;
    
    // التحقق من عدم وجود جهة اتصال مكررة
    db.get('SELECT * FROM contacts WHERE user_id = ? AND contact_name = ?', [req.session.userId, name], (err, existing) => {
        if (err) {
            res.json({ success: false, message: err.message });
            return;
        }
        
        if (existing) {
            res.json({ success: false, message: 'جهة الاتصال موجودة مسبقاً' });
            return;
        }
        
        db.run(`
            INSERT INTO contacts (user_id, contact_name, contact_phone, contact_email, contact_group, contact_notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [req.session.userId, name, phone || '', email || '', group || 'عام', notes || ''], function(err) {
            if (err) {
                console.error('Error adding contact:', err);
                res.json({ success: false, message: err.message });
                return;
            }
            res.json({ success: true, contact: { id: this.lastID, name, phone, email, group, notes } });
        });
    });
});

// رفع الملفات
app.post('/upload-file', upload.single('file'), (req, res) => {
    if (!req.file) {
        res.json({ success: false, message: 'لا يوجد ملف' });
        return;
    }
    
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
        success: true,
        fileUrl: fileUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype
    });
});

// جلب المحادثة
app.post('/get-conversation', (req, res) => {
    if (!req.session.userId) {
        res.json({ messages: [] });
        return;
    }
    
    const { userId, contactId } = req.body;
    
    db.all(`
        SELECT * FROM messages 
        WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
        ORDER BY timestamp ASC
        LIMIT 500
    `, [userId, contactId, contactId, userId], (err, messages) => {
        if (err) {
            console.error('Error loading conversation:', err);
            res.json({ messages: [] });
            return;
        }
        
        const formattedMessages = messages.map(m => ({
            id: m.id,
            from: m.from_user,
            to: m.to_user,
            message: m.message,
            type: m.message_type,
            fileUrl: m.file_url,
            fileName: m.file_name,
            audioUrl: m.audio_url,
            videoUrl: m.video_url,
            duration: m.duration,
            read: m.is_read === 1,
            timestamp: m.timestamp
        }));
        
        res.json({ messages: formattedMessages });
    });
});

// ==================== Socket.IO ====================
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('📡 مستخدم جديد متصل');
    
    socket.on('register user', (data) => {
        if (data.username) {
            onlineUsers.set(data.username, socket.id);
            socket.username = data.username;
            console.log(`✅ ${data.username} متصل الآن`);
            
            // تحديث حالة المستخدم في قاعدة البيانات
            db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE username = ?', ['online', data.username]);
            
            // إشعار جميع المستخدمين
            io.emit('user status change', { username: data.username, status: 'online' });
        }
    });
    
    socket.on('private message', (data) => {
        const { from, to, message, timestamp, messageId } = data;
        
        // حفظ الرسالة في قاعدة البيانات
        db.run(`
            INSERT INTO messages (from_user, to_user, message, message_type, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `, [from, to, message, 'text', timestamp]);
        
        // إرسال الرسالة للمستقبل
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('private message', {
                from, message, timestamp, messageId, type: 'text'
            });
        }
    });
    
    socket.on('send file', (data) => {
        const { from, to, fileUrl, fileName, fileType, timestamp } = data;
        
        db.run(`
            INSERT INTO messages (from_user, to_user, file_url, file_name, message_type, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [from, to, fileUrl, fileName, 'file', timestamp]);
        
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('file received', {
                from, fileUrl, fileName, fileType, timestamp
            });
        }
    });
    
    socket.on('voice message', (data) => {
        const { from, to, audioUrl, duration, timestamp } = data;
        
        db.run(`
            INSERT INTO messages (from_user, to_user, audio_url, duration, message_type, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [from, to, audioUrl, duration, 'voice', timestamp]);
        
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('voice message', {
                from, audioUrl, duration, timestamp
            });
        }
    });
    
    socket.on('typing', (data) => {
        const { from, to } = data;
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('typing', { from });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.username) {
            console.log(`🔴 ${socket.username} غير متصل`);
            onlineUsers.delete(socket.username);
            
            // تحديث حالة المستخدم
            db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE username = ?', ['offline', socket.username]);
            
            // إشعار جميع المستخدمين
            io.emit('user status change', { username: socket.username, status: 'offline' });
        }
    });
});

// ==================== إنشاء ملف index.html تلقائياً ====================
const indexPath = path.join(__dirname, 'public', 'index.html');
if (!fs.existsSync(indexPath)) {
    const indexHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>نظام الدردشة</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }
        .login-container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 350px;
        }
        h2 {
            text-align: center;
            color: #075e54;
            margin-bottom: 30px;
        }
        input {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
        }
        button {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #075e54, #128c7e);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 10px;
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(18,140,126,0.3);
        }
        .error {
            color: red;
            text-align: center;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h2>📱 واصل - نظام الدردشة</h2>
        <input type="text" id="username" placeholder="اسم المستخدم">
        <input type="password" id="password" placeholder="كلمة المرور">
        <button onclick="login()">تسجيل الدخول</button>
        <div class="error" id="error"></div>
        <hr style="margin: 20px 0">
        <p style="text-align: center; font-size: 12px; color: #666;">
            مستخدم تجريبي: admin / admin123
        </p>
    </div>

    <script>
        async function login() {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const error = document.getElementById('error');
            
            if (!username || !password) {
                error.textContent = 'الرجاء إدخال اسم المستخدم وكلمة المرور';
                return;
            }
            
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                sessionStorage.setItem('accessGranted', 'true');
                sessionStorage.setItem('username', data.user.username);
                window.location.href = '/chat.html';
            } else {
                error.textContent = data.message;
            }
        }
    </script>
</body>
</html>`;
    
    fs.writeFileSync(indexPath, indexHtml);
    console.log('✅ تم إنشاء ملف public/index.html');
}

// إنشاء ملف chat.html تلقائياً (نسخة مبسطة)
const chatPath = path.join(__dirname, 'public', 'chat.html');
if (!fs.existsSync(chatPath)) {
    const chatHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>الدردشة - واصل</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #e5ddd5;
            height: 100vh;
            overflow: hidden;
        }
        .app {
            display: flex;
            height: 100vh;
            max-width: 1400px;
            margin: 0 auto;
        }
        .sidebar {
            width: 350px;
            background: white;
            border-left: 1px solid #e0e0e0;
            display: flex;
            flex-direction: column;
        }
        .sidebar-header {
            background: linear-gradient(135deg, #075e54, #128c7e);
            color: white;
            padding: 16px;
        }
        .sidebar-header h3 { font-size: 18px; }
        .user-info {
            padding: 12px 15px;
            background: #f0f0f0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .user-avatar {
            width: 40px; height: 40px;
            border-radius: 50%;
            background: #128c7e;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
        }
        .search-box {
            padding: 10px;
            background: #f0f0f0;
        }
        .search-box input {
            width: 100%;
            padding: 9px 14px;
            border: 1px solid #e0e0e0;
            border-radius: 20px;
            outline: none;
        }
        .contacts-list {
            flex: 1;
            overflow-y: auto;
        }
        .contact-item {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            cursor: pointer;
            border-bottom: 1px solid #e0e0e0;
        }
        .contact-item:hover { background: #f5f5f5; }
        .contact-avatar {
            width: 48px; height: 48px;
            border-radius: 50%;
            background: #128c7e;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin-left: 12px;
        }
        .contact-info { flex: 1; }
        .contact-name { font-weight: bold; margin-bottom: 3px; }
        .contact-status { font-size: 11px; }
        .status-online { color: #25d366; }
        .chat-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: #e5ddd5;
        }
        .empty-chat {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #666;
        }
        .btn-add-contact {
            background: linear-gradient(135deg, #28a745, #20c997);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            margin-top: 10px;
        }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal.active { display: flex; }
        .modal-content {
            background: white;
            border-radius: 20px;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            overflow: auto;
        }
        .modal-header {
            background: linear-gradient(135deg, #075e54, #128c7e);
            color: white;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
        }
        .modal-body { padding: 20px; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
        .form-group input, .form-group select {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        .btn-save {
            background: #28a745;
            color: white;
            border: none;
            padding: 10px;
            border-radius: 5px;
            cursor: pointer;
            width: 100%;
        }
        .search-results {
            margin-top: 15px;
            max-height: 300px;
            overflow-y: auto;
        }
        .result-item {
            padding: 10px;
            border: 1px solid #ddd;
            margin-bottom: 10px;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .add-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 5px;
            cursor: pointer;
        }
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: #28a745;
            color: white;
            border-radius: 8px;
            animation: slideIn 0.3s ease;
            z-index: 2000;
        }
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="app">
        <div class="sidebar">
            <div class="sidebar-header">
                <h3>المحادثات</h3>
            </div>
            <div class="user-info" id="userInfo">
                <div class="user-avatar" id="userAvatar"></div>
                <div>
                    <div class="user-name" id="userName"></div>
                </div>
            </div>
            <div class="search-box">
                <input type="text" placeholder="بحث في جهات الاتصال..." id="searchInput">
            </div>
            <div class="contacts-list" id="contactsList"></div>
            <div style="padding: 10px;">
                <button class="btn-add-contact" onclick="openAddContactModal()">➕ إضافة جهة اتصال</button>
            </div>
        </div>
        <div class="chat-area" id="chatArea">
            <div class="empty-chat">
                <div style="text-align: center;">
                    <div style="font-size: 48px;">💬</div>
                    <div>اختر محادثة لبدء المراسلة</div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal" id="addContactModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>➕ إضافة جهة اتصال</h3>
                <button onclick="closeAddContactModal()" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>🔍 بحث عن مستخدمين</label>
                    <input type="text" id="searchUsersInput" placeholder="ابحث بالاسم أو رقم الهاتف..." onkeyup="searchUsers()">
                </div>
                <div id="searchResults" class="search-results"></div>
                <hr style="margin: 20px 0;">
                <h4>➕ إضافة مستخدم جديد</h4>
                <div class="form-group">
                    <input type="text" id="newUserName" placeholder="الاسم الكامل *">
                </div>
                <div class="form-group">
                    <input type="tel" id="newUserPhone" placeholder="رقم الهاتف">
                </div>
                <div class="form-group">
                    <input type="email" id="newUserEmail" placeholder="البريد الإلكتروني">
                </div>
                <button class="btn-save" onclick="addNewContact()">➕ إضافة جهة الاتصال</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        let socket;
        let currentUser = null;
        let allContacts = [];
        let allUsers = [];
        
        async function loadUser() {
            currentUser = { username: sessionStorage.getItem('username') };
            document.getElementById('userName').textContent = currentUser.username;
            document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
            
            await loadContacts();
            await loadAllUsers();
            initSocket();
        }
        
        function initSocket() {
            socket = io();
            socket.on('connect', () => {
                socket.emit('register user', { username: currentUser.username });
            });
        }
        
        async function loadAllUsers() {
            const response = await fetch('/api/all-users');
            const data = await response.json();
            if (data.success) {
                allUsers = data.users;
            }
        }
        
        async function loadContacts() {
            const response = await fetch('/get-contacts');
            const data = await response.json();
            allContacts = data.contacts || [];
            displayContacts();
        }
        
        function displayContacts() {
            const container = document.getElementById('contactsList');
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const filtered = allContacts.filter(c => c.name.toLowerCase().includes(searchTerm));
            
            if (filtered.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:20px;">لا توجد جهات اتصال</div>';
                return;
            }
            
            container.innerHTML = filtered.map(contact => \`
                <div class="contact-item" onclick="openChat('\${contact.name}')">
                    <div class="contact-avatar">\${contact.name.charAt(0).toUpperCase()}</div>
                    <div class="contact-info">
                        <div class="contact-name">\${escapeHtml(contact.name)}</div>
                        <div class="contact-status \${contact.status === 'online' ? 'status-online' : ''}">
                            \${contact.status === 'online' ? '● متصل' : '○ غير متصل'}
                        </div>
                    </div>
                </div>
            \`).join('');
        }
        
        function searchUsers() {
            const term = document.getElementById('searchUsersInput').value.toLowerCase();
            const resultsDiv = document.getElementById('searchResults');
            
            if (!term) {
                resultsDiv.innerHTML = '';
                return;
            }
            
            const filtered = allUsers.filter(u => 
                u.username.toLowerCase().includes(term) || 
                (u.phone && u.phone.includes(term))
            );
            
            if (filtered.length === 0) {
                resultsDiv.innerHTML = '<div style="text-align:center;padding:10px;">لا توجد نتائج</div>';
                return;
            }
            
            resultsDiv.innerHTML = filtered.map(user => \`
                <div class="result-item">
                    <div>
                        <strong>\${escapeHtml(user.username)}</strong>
                        <div style="font-size:12px;color:#666;">\${user.phone || ''}</div>
                    </div>
                    <button class="add-btn" onclick="addContactFromSearch('\${escapeHtml(user.username)}', '\${escapeHtml(user.phone || '')}', '\${escapeHtml(user.email || '')}')">+ إضافة</button>
                </div>
            \`).join('');
        }
        
        async function addContactFromSearch(name, phone, email) {
            const response = await fetch('/api/add-contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, phone, email })
            });
            
            const data = await response.json();
            if (data.success) {
                showNotification('✅ تمت الإضافة بنجاح');
                await loadContacts();
                closeAddContactModal();
            } else {
                showNotification('❌ فشل في الإضافة', 'error');
            }
        }
        
        async function addNewContact() {
            const name = document.getElementById('newUserName').value.trim();
            const phone = document.getElementById('newUserPhone').value.trim();
            const email = document.getElementById('newUserEmail').value.trim();
            
            if (!name) {
                showNotification('❌ الرجاء إدخال الاسم', 'error');
                return;
            }
            
            await addContactFromSearch(name, phone, email);
            document.getElementById('newUserName').value = '';
            document.getElementById('newUserPhone').value = '';
            document.getElementById('newUserEmail').value = '';
        }
        
        function openChat(contactName) {
            // فتح الدردشة مع جهة الاتصال
            alert('جاري فتح محادثة مع ' + contactName);
        }
        
        function openAddContactModal() {
            document.getElementById('addContactModal').classList.add('active');
            document.getElementById('searchUsersInput').value = '';
            document.getElementById('searchResults').innerHTML = '';
        }
        
        function closeAddContactModal() {
            document.getElementById('addContactModal').classList.remove('active');
        }
        
        function showNotification(message, type = 'success') {
            const notif = document.createElement('div');
            notif.className = 'notification';
            notif.textContent = message;
            document.body.appendChild(notif);
            setTimeout(() => notif.remove(), 3000);
        }
        
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        document.getElementById('searchInput').addEventListener('input', displayContacts);
        
        loadUser();
    </script>
</body>
</html>`;
    
    fs.writeFileSync(chatPath, chatHtml);
    console.log('✅ تم إنشاء ملف public/chat.html');
}

// ==================== تشغيل الخادم ====================
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initDatabase();
        
        server.listen(PORT, () => {
            console.log(`
╔══════════════════════════════════════════════════════════╗
║     🚀 الخادم يعمل بنجاح                                 ║
║     📡 الرابط: http://localhost:${PORT}                   ║
║     📁 قاعدة البيانات: ${dbPath}                         ║
║     📂 مجلد الرفع: ${path.join(__dirname, 'uploads')}    ║
║                                                          ║
║     👤 مستخدم تجريبي: admin / admin123                   ║
╚══════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ فشل في تشغيل الخادم:', error);
    }
}

startServer();
