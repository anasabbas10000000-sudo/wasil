const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// ==================== تكوين Cloudinary ====================
// استخدم المتغيرات البيئية من Render
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dezprpy5q',
    api_key: process.env.CLOUDINARY_API_KEY || '462762935819578',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'vV6GrKIp-VBifpafhdz4Bs82xdA'
});

// إعداد الخادم
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// تحديد المجلد الذي يحتوي على ملفات الواجهة الأمامية
app.use(express.static(__dirname));
app.use(express.json());

// إنشاء مجلد uploads مؤقت للتخزين المؤقت (اختياري)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('✅ تم إنشاء مجلد uploads مؤقت');
}

// ==================== إعداد Multer للتخزين المؤقت ====================
// استخدام memory storage بدلاً من disk storage للرفع المباشر إلى Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'audio/webm',
        'audio/mpeg',
        'audio/mp3',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`نوع الملف غير مدعوم: ${file.mimetype}`), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50 ميجابايت
    },
    fileFilter: fileFilter
});

// ==================== دالة رفع الملف إلى Cloudinary ====================
async function uploadToCloudinary(fileBuffer, originalName, mimetype) {
    return new Promise((resolve, reject) => {
        // تحديد نوع المورد بناءً على نوع الملف
        let resourceType = 'auto';
        if (mimetype.startsWith('image/')) resourceType = 'image';
        else if (mimetype.startsWith('video/')) resourceType = 'video';
        else if (mimetype.startsWith('audio/')) resourceType = 'raw';
        else resourceType = 'raw';
        
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: resourceType,
                folder: 'wasil_uploads',
                public_id: `${Date.now()}_${originalName.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_')}`,
                timeout: 120000 // 120 ثانية مهلة
            },
            (error, result) => {
                if (error) {
                    console.error('خطأ في رفع Cloudinary:', error);
                    reject(error);
                } else {
                    resolve(result);
                }
            }
        );
        
        uploadStream.end(fileBuffer);
    });
}

// ==================== مسار رفع الملفات (متعدد المسارات) ====================
async function handleFileUpload(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع أي ملف'
            });
        }
        
        const { username, to } = req.body;
        
        console.log(`📤 جاري رفع الملف إلى Cloudinary: ${req.file.originalname} (${req.file.size} bytes)`);
        
        // رفع الملف إلى Cloudinary
        const cloudinaryResult = await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
        );
        
        console.log(`✅ تم رفع الملف بنجاح إلى Cloudinary: ${cloudinaryResult.secure_url}`);
        
        res.json({
            success: true,
            fileUrl: cloudinaryResult.secure_url,
            fileName: req.file.originalname,
            fileType: req.file.mimetype,
            fileSize: req.file.size,
            publicId: cloudinaryResult.public_id,
            message: 'تم رفع الملف بنجاح إلى Cloudinary'
        });
        
    } catch (error) {
        console.error('❌ خطأ في رفع الملف:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في رفع الملف: ' + error.message
        });
    }
}

// المسارات المتعددة لرفع الملفات (للتوافق مع الكود الأمامي)
app.post('/upload-file', upload.single('file'), handleFileUpload);
app.post('/api/upload', upload.single('file'), handleFileUpload);
app.post('/upload', upload.single('file'), handleFileUpload);
app.post('/file/upload', upload.single('file'), handleFileUpload);

// ==================== خدمة الملفات الثابتة (للملفات المحلية فقط) ====================
app.use('/uploads', express.static(uploadsDir));

// ==================== مسار حذف الملف من Cloudinary ====================
app.post('/delete-file', async (req, res) => {
    const { fileUrl, publicId } = req.body;
    
    if (!publicId && !fileUrl) {
        return res.status(400).json({ success: false, message: 'لم يتم تحديد الملف' });
    }
    
    try {
        let publicIdToDelete = publicId;
        
        // إذا لم يتم إرسال publicId، نحاول استخراجه من الرابط
        if (!publicIdToDelete && fileUrl) {
            // استخراج publicId من رابط Cloudinary
            const matches = fileUrl.match(/\/v\d+\/(.+?)\./);
            if (matches && matches[1]) {
                publicIdToDelete = matches[1];
            }
        }
        
        if (publicIdToDelete) {
            const result = await cloudinary.uploader.destroy(publicIdToDelete, {
                resource_type: 'auto'
            });
            
            if (result.result === 'ok') {
                console.log(`🗑️ تم حذف الملف من Cloudinary: ${publicIdToDelete}`);
                res.json({ success: true, message: 'تم حذف الملف بنجاح' });
            } else {
                res.json({ success: false, message: 'الملف غير موجود في Cloudinary' });
            }
        } else {
            res.json({ success: false, message: 'لا يمكن تحديد publicId للملف' });
        }
    } catch (error) {
        console.error('خطأ في حذف الملف:', error);
        res.status(500).json({ success: false, message: 'حدث خطأ في حذف الملف' });
    }
});

// ==================== مسارات البيانات ====================
const codesFilePath = path.join(__dirname, 'access_codes.json');
const contactsFilePath = path.join(__dirname, 'contacts.json');
const privateMessagesPath = path.join(__dirname, 'private_messages.json');

// دوال قراءة وحفظ البيانات (كما هي)
function readAccessCodes() {
    try {
        if (fs.existsSync(codesFilePath)) {
            return JSON.parse(fs.readFileSync(codesFilePath, 'utf8'));
        } else {
            const defaultCodes = { codes: ["1234", "5678"] };
            fs.writeFileSync(codesFilePath, JSON.stringify(defaultCodes, null, 2));
            return defaultCodes;
        }
    } catch (error) {
        console.error('خطأ في قراءة ملف الرموز:', error);
        return { codes: ["1234"] };
    }
}

function saveAccessCodes(codesData) {
    try {
        fs.writeFileSync(codesFilePath, JSON.stringify(codesData, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ ملف الرموز:', error);
        return false;
    }
}

function readContacts() {
    try {
        if (fs.existsSync(contactsFilePath)) {
            return JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
        } else {
            const defaultContacts = {
                contacts: [
                    { id: "1", name: "أحمد محمد", phone: "0501111111", avatar: "أ", status: "online" },
                    { id: "2", name: "سارة أحمد", phone: "0502222222", avatar: "س", status: "offline" },
                    { id: "3", name: "محمد علي", phone: "0503333333", avatar: "م", status: "online" },
                    { id: "4", name: "فاطمة حسن", phone: "0504444444", avatar: "ف", status: "offline" },
                    { id: "5", name: "عبدالله عمر", phone: "0505555555", avatar: "ع", status: "online" }
                ]
            };
            fs.writeFileSync(contactsFilePath, JSON.stringify(defaultContacts, null, 2));
            return defaultContacts;
        }
    } catch (error) {
        console.error('خطأ في قراءة ملف جهات الاتصال:', error);
        return { contacts: [] };
    }
}

function saveContacts(contactsData) {
    try {
        fs.writeFileSync(contactsFilePath, JSON.stringify(contactsData, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ ملف جهات الاتصال:', error);
        return false;
    }
}

function readPrivateMessages() {
    try {
        if (fs.existsSync(privateMessagesPath)) {
            return JSON.parse(fs.readFileSync(privateMessagesPath, 'utf8'));
        } else {
            const defaultMessages = { conversations: {} };
            fs.writeFileSync(privateMessagesPath, JSON.stringify(defaultMessages, null, 2));
            return defaultMessages;
        }
    } catch (error) {
        console.error('خطأ في قراءة ملف الرسائل:', error);
        return { conversations: {} };
    }
}

function savePrivateMessages(messagesData) {
    try {
        fs.writeFileSync(privateMessagesPath, JSON.stringify(messagesData, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ ملف الرسائل:', error);
        return false;
    }
}

// ==================== API Routes ====================
app.post('/verify-code', (req, res) => {
    const { code } = req.body;
    const codesData = readAccessCodes();
    
    if (codesData.codes.includes(code)) {
        res.json({ success: true, message: 'تم التحقق بنجاح' });
    } else {
        res.json({ success: false, message: 'رمز غير صحيح' });
    }
});

app.post('/add-code', (req, res) => {
    const { newCode } = req.body;
    const codesData = readAccessCodes();
    
    if (!codesData.codes.includes(newCode)) {
        codesData.codes.push(newCode);
        if (saveAccessCodes(codesData)) {
            res.json({ success: true, message: 'تم إضافة الرمز بنجاح' });
        } else {
            res.json({ success: false, message: 'حدث خطأ في حفظ الرمز' });
        }
    } else {
        res.json({ success: false, message: 'الرمز موجود مسبقاً' });
    }
});

app.post('/remove-code', (req, res) => {
    const { code } = req.body;
    const codesData = readAccessCodes();
    const index = codesData.codes.indexOf(code);
    
    if (index !== -1) {
        codesData.codes.splice(index, 1);
        if (saveAccessCodes(codesData)) {
            res.json({ success: true, message: 'تم إزالة الرمز بنجاح' });
        } else {
            res.json({ success: false, message: 'حدث خطأ في حفظ التغييرات' });
        }
    } else {
        res.json({ success: false, message: 'الرمز غير موجود' });
    }
});

app.get('/get-codes', (req, res) => {
    const codesData = readAccessCodes();
    res.json(codesData);
});

app.get('/get-contacts', (req, res) => {
    const contactsData = readContacts();
    res.json(contactsData);
});

app.post('/add-contact', (req, res) => {
    const { name, phone } = req.body;
    const contactsData = readContacts();
    
    const newContact = {
        id: Date.now().toString(),
        name: name,
        phone: phone,
        avatar: name.charAt(0),
        status: "offline"
    };
    
    contactsData.contacts.push(newContact);
    if (saveContacts(contactsData)) {
        res.json({ success: true, contact: newContact });
    } else {
        res.json({ success: false, message: 'حدث خطأ في حفظ جهة الاتصال' });
    }
});

app.post('/delete-contact', (req, res) => {
    const { contactId } = req.body;
    const contactsData = readContacts();
    const index = contactsData.contacts.findIndex(c => c.id === contactId);
    
    if (index !== -1) {
        contactsData.contacts.splice(index, 1);
        if (saveContacts(contactsData)) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'حدث خطأ في الحذف' });
        }
    } else {
        res.json({ success: false, message: 'جهة الاتصال غير موجودة' });
    }
});

app.post('/get-conversation', (req, res) => {
    const { userId, contactId } = req.body;
    const messagesData = readPrivateMessages();
    const conversationKey = [userId, contactId].sort().join('_');
    
    const conversation = messagesData.conversations[conversationKey] || [];
    res.json({ messages: conversation });
});

app.post('/cleanup-messages', (req, res) => {
    const { username, days } = req.body;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const messagesData = readPrivateMessages();
    let cleanedCount = 0;
    
    for (const [key, messages] of Object.entries(messagesData.conversations)) {
        const filteredMessages = messages.filter(msg => {
            const msgDate = new Date(msg.timestamp);
            return msgDate > cutoffDate;
        });
        
        cleanedCount += messages.length - filteredMessages.length;
        messagesData.conversations[key] = filteredMessages;
    }
    
    savePrivateMessages(messagesData);
    console.log(`🧹 تم تنظيف ${cleanedCount} رسالة قديمة للمستخدم ${username}`);
    res.json({ success: true, cleanedCount });
});

app.post('/update-status', (req, res) => {
    const { userId, status } = req.body;
    const contactsData = readContacts();
    const contact = contactsData.contacts.find(c => c.id === userId || c.name === userId);
    
    if (contact) {
        contact.status = status;
        saveContacts(contactsData);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// ==================== Socket.IO Events ====================
const connectedUsers = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
    console.log('✅ مستخدم جديد متصل: ' + socket.id);
    
    socket.on('register user', (userData) => {
        const { username, userId } = userData;
        connectedUsers.set(socket.id, { username, userId });
        userSockets.set(username, socket.id);
        
        const contactsData = readContacts();
        const contact = contactsData.contacts.find(c => c.name === username);
        if (contact) {
            contact.status = 'online';
            saveContacts(contactsData);
        }
        
        io.emit('user status change', { username, status: 'online' });
        console.log(`📱 المستخدم ${username} سجل الدخول`);
    });
    
    socket.on('private message', (data) => {
        const { from, to, message, timestamp, messageId } = data;
        
        const messagesData = readPrivateMessages();
        const conversationKey = [from, to].sort().join('_');
        
        if (!messagesData.conversations[conversationKey]) {
            messagesData.conversations[conversationKey] = [];
        }
        
        const messageObj = {
            id: messageId || Date.now().toString(),
            from: from,
            to: to,
            message: message,
            type: 'text',
            timestamp: timestamp || new Date().toISOString(),
            read: false
        };
        
        messagesData.conversations[conversationKey].push(messageObj);
        savePrivateMessages(messagesData);
        
        const recipientSocketId = userSockets.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private message', {
                from: from,
                message: message,
                timestamp: timestamp,
                messageId: messageId
            });
        }
        
        console.log(`💬 رسالة من ${from} إلى ${to}`);
    });
    
    socket.on('send file', (data) => {
        const { from, to, fileUrl, fileName, fileType, timestamp, messageId } = data;
        
        const messagesData = readPrivateMessages();
        const conversationKey = [from, to].sort().join('_');
        
        if (!messagesData.conversations[conversationKey]) {
            messagesData.conversations[conversationKey] = [];
        }
        
        const messageObj = {
            id: messageId || Date.now().toString(),
            from: from,
            to: to,
            type: 'file',
            fileUrl: fileUrl,
            fileName: fileName,
            fileType: fileType,
            timestamp: timestamp || new Date().toISOString(),
            read: false
        };
        
        messagesData.conversations[conversationKey].push(messageObj);
        savePrivateMessages(messagesData);
        
        const recipientSocketId = userSockets.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('file received', {
                from: from,
                fileUrl: fileUrl,
                fileName: fileName,
                fileType: fileType,
                timestamp: timestamp
            });
        }
        
        console.log(`📎 ملف من ${from} إلى ${to}: ${fileName}`);
    });
    
    socket.on('voice message', (data) => {
        const { from, to, audioUrl, duration, timestamp, messageId } = data;
        
        const messagesData = readPrivateMessages();
        const conversationKey = [from, to].sort().join('_');
        
        if (!messagesData.conversations[conversationKey]) {
            messagesData.conversations[conversationKey] = [];
        }
        
        const messageObj = {
            id: messageId || Date.now().toString(),
            from: from,
            to: to,
            type: 'voice',
            audioUrl: audioUrl,
            duration: duration,
            timestamp: timestamp || new Date().toISOString(),
            read: false
        };
        
        messagesData.conversations[conversationKey].push(messageObj);
        savePrivateMessages(messagesData);
        
        const recipientSocketId = userSockets.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('voice message', {
                from: from,
                audioUrl: audioUrl,
                duration: duration,
                timestamp: timestamp
            });
        }
        
        console.log(`🎤 رسالة صوتية من ${from} إلى ${to}`);
    });
    
    socket.on('mark message read', (data) => {
        const { userId, messageId, contactId } = data;
        const messagesData = readPrivateMessages();
        const conversationKey = [userId, contactId].sort().join('_');
        
        if (messagesData.conversations[conversationKey]) {
            const message = messagesData.conversations[conversationKey].find(msg => msg.id == messageId);
            if (message && !message.read) {
                message.read = true;
                savePrivateMessages(messagesData);
                
                const senderSocketId = userSockets.get(contactId);
                if (senderSocketId) {
                    io.to(senderSocketId).emit('message read', { messageId });
                }
            }
        }
    });
    
    socket.on('typing', (data) => {
        const { from, to } = data;
        const recipientSocketId = userSockets.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('typing', { from });
        }
    });
    
    socket.on('delete message', (data) => {
        const { messageId, userId, contactId } = data;
        const messagesData = readPrivateMessages();
        const conversationKey = [userId, contactId].sort().join('_');
        
        if (messagesData.conversations[conversationKey]) {
            const index = messagesData.conversations[conversationKey].findIndex(msg => msg.id == messageId);
            if (index !== -1) {
                messagesData.conversations[conversationKey].splice(index, 1);
                savePrivateMessages(messagesData);
                console.log(`🗑️ تم حذف رسالة من ${userId}`);
            }
        }
    });
    
    socket.on('disconnect', () => {
        const userInfo = connectedUsers.get(socket.id);
        if (userInfo) {
            const contactsData = readContacts();
            const contact = contactsData.contacts.find(c => c.name === userInfo.username);
            if (contact) {
                contact.status = 'offline';
                saveContacts(contactsData);
            }
            io.emit('user status change', { username: userInfo.username, status: 'offline' });
            userSockets.delete(userInfo.username);
            console.log(`❌ المستخدم ${userInfo.username} غير متصل`);
        }
        connectedUsers.delete(socket.id);
    });
});

// ==================== تشغيل الخادم ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 الخادم يعمل بنجاح على: http://localhost:${PORT}`);
    console.log(`☁️  Cloudinary جاهز لاستقبال الملفات`);
    console.log(`📁 مجلد رفع الملفات المؤقت: ${uploadsDir}`);
    console.log(`\n✅ جميع الميزات جاهزة للعمل!\n`);
});

// معالجة الأخطاء
process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ رفض غير معالج:', reason);
});
