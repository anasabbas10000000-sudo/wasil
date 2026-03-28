const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// ==================== تكوين Cloudinary ====================
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
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 10000,
    connectTimeout: 30000,
    allowEIO3: true,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e8
});

// تحديد المجلد الذي يحتوي على ملفات الواجهة الأمامية
app.use(express.static(__dirname));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// إنشاء مجلد uploads مؤقت للتخزين المؤقت
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('✅ تم إنشاء مجلد uploads مؤقت');
}

// ==================== إعداد Multer للتخزين المؤقت ====================
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm', 'video/quicktime',
        'audio/webm', 'audio/mpeg', 'audio/mp3',
        'application/pdf', 'application/msword',
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
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: fileFilter
});

// ==================== دالة رفع الملف إلى Cloudinary ====================
async function uploadToCloudinary(fileBuffer, originalName, mimetype) {
    return new Promise((resolve, reject) => {
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
                timeout: 120000
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

// ==================== مسار رفع الملفات ====================
async function handleFileUpload(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'لم يتم رفع أي ملف' });
        }
        
        console.log(`📤 جاري رفع الملف إلى Cloudinary: ${req.file.originalname} (${req.file.size} bytes)`);
        
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
            publicId: cloudinaryResult.public_id
        });
        
    } catch (error) {
        console.error('❌ خطأ في رفع الملف:', error);
        res.status(500).json({ success: false, message: 'حدث خطأ في رفع الملف: ' + error.message });
    }
}

// مسارات رفع الملفات
app.post('/upload-file', upload.single('file'), handleFileUpload);
app.post('/api/upload', upload.single('file'), handleFileUpload);
app.post('/upload', upload.single('file'), handleFileUpload);
app.use('/uploads', express.static(uploadsDir));

// ==================== مسار حذف الملف ====================
app.post('/delete-file', async (req, res) => {
    const { fileUrl, publicId } = req.body;
    
    if (!publicId && !fileUrl) {
        return res.status(400).json({ success: false, message: 'لم يتم تحديد الملف' });
    }
    
    try {
        let publicIdToDelete = publicId;
        
        if (!publicIdToDelete && fileUrl) {
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
const settingsFilePath = path.join(__dirname, 'user_settings.json');
const sessionFilePath = path.join(__dirname, 'user_sessions.json');

// دوال قراءة وحفظ البيانات
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

// ==================== إدارة الجلسات ====================
function saveUserSession(username, sessionData) {
    try {
        let sessions = {};
        if (fs.existsSync(sessionFilePath)) {
            sessions = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
        }
        sessions[username] = {
            ...sessionData,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(sessionFilePath, JSON.stringify(sessions, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ جلسة المستخدم:', error);
        return false;
    }
}

function getUserSession(username) {
    try {
        if (fs.existsSync(sessionFilePath)) {
            const sessions = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
            return sessions[username] || null;
        }
        return null;
    } catch (error) {
        console.error('خطأ في قراءة جلسة المستخدم:', error);
        return null;
    }
}

// ==================== إعدادات المستخدم للرنين ====================
function readUserSettings(username) {
    try {
        if (fs.existsSync(settingsFilePath)) {
            const allSettings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
            return allSettings[username] || {
                ringtone: 'default',
                volume: 80,
                vibrate: true,
                notifications: true,
                ringtoneFile: 'default',
                videoQuality: 'high',
                cameraEnabled: true,
                micEnabled: true,
                theme: 'light',
                language: 'ar'
            };
        } else {
            return {
                ringtone: 'default',
                volume: 80,
                vibrate: true,
                notifications: true,
                ringtoneFile: 'default',
                videoQuality: 'high',
                cameraEnabled: true,
                micEnabled: true,
                theme: 'light',
                language: 'ar'
            };
        }
    } catch (error) {
        console.error('خطأ في قراءة إعدادات المستخدم:', error);
        return {
            ringtone: 'default',
            volume: 80,
            vibrate: true,
            notifications: true,
            ringtoneFile: 'default',
            videoQuality: 'high',
            cameraEnabled: true,
            micEnabled: true,
            theme: 'light',
            language: 'ar'
        };
    }
}

function saveUserSettings(username, settings) {
    try {
        let allSettings = {};
        if (fs.existsSync(settingsFilePath)) {
            allSettings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
        }
        allSettings[username] = settings;
        fs.writeFileSync(settingsFilePath, JSON.stringify(allSettings, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ إعدادات المستخدم:', error);
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
    const username = req.query.username || 'default';
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

// ==================== مسارات إعدادات الرنين ====================
app.get('/get-ringtone-settings', (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ success: false, message: 'اسم المستخدم مطلوب' });
    }
    const settings = readUserSettings(username);
    res.json({ success: true, settings });
});

app.post('/update-ringtone-settings', (req, res) => {
    const { username, settings } = req.body;
    if (!username || !settings) {
        return res.status(400).json({ success: false, message: 'بيانات غير مكتملة' });
    }
    
    const success = saveUserSettings(username, settings);
    if (success) {
        res.json({ success: true, message: 'تم تحديث الإعدادات بنجاح' });
    } else {
        res.status(500).json({ success: false, message: 'حدث خطأ في حفظ الإعدادات' });
    }
});

// ==================== مسار حفظ حالة المستخدم ====================
app.post('/save-user-state', (req, res) => {
    const { username, state } = req.body;
    if (!username || !state) {
        return res.status(400).json({ success: false, message: 'بيانات غير مكتملة' });
    }
    
    const success = saveUserSession(username, state);
    if (success) {
        res.json({ success: true, message: 'تم حفظ حالة المستخدم' });
    } else {
        res.status(500).json({ success: false, message: 'حدث خطأ في حفظ الحالة' });
    }
});

app.get('/get-user-state', (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ success: false, message: 'اسم المستخدم مطلوب' });
    }
    
    const session = getUserSession(username);
    res.json({ success: true, state: session });
});

// ==================== قائمة الرنات المتاحة ====================
app.get('/available-ringtones', (req, res) => {
    const ringtonesDir = path.join(__dirname, 'ringtones');
    let ringtones = ['default'];
    
    try {
        if (fs.existsSync(ringtonesDir)) {
            const files = fs.readdirSync(ringtonesDir);
            const audioFiles = files.filter(file => 
                file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.ogg')
            );
            ringtones.push(...audioFiles.map(file => file.replace(/\.[^/.]+$/, '')));
        }
    } catch (error) {
        console.error('خطأ في قراءة ملفات الرنات:', error);
    }
    
    res.json({ success: true, ringtones });
});

// ==================== إعدادات جودة الفيديو المحسنة ====================
function getVideoQualityConfig(quality = 'high') {
    const configs = {
        low: {
            video: { width: 320, height: 240, frameRate: 15 },
            bitrate: 200000
        },
        medium: {
            video: { width: 640, height: 480, frameRate: 24 },
            bitrate: 500000
        },
        high: {
            video: { width: 1280, height: 720, frameRate: 30 },
            bitrate: 1000000
        },
        hd: {
            video: { width: 1920, height: 1080, frameRate: 30 },
            bitrate: 2000000
        }
    };
    return configs[quality] || configs.high;
}

// ==================== Socket.IO Events ====================
const connectedUsers = new Map();
const userSockets = new Map();
const activeCalls = new Map();
const cleanupIntervals = new Map();
const connectionTimers = new Map();
const callInterruptionTimers = new Map();

function getConversationId(user1, user2) {
    return [user1, user2].sort().join('_');
}

function startCleanupInterval() {
    const interval = setInterval(() => {
        const now = Date.now();
        // تنظيف المكالمات القديمة
        for (const [callId, callInfo] of activeCalls.entries()) {
            if (now - callInfo.startTime > 3600000) {
                console.log(`🧹 تنظيف مكالمة قديمة: ${callId}`);
                activeCalls.delete(callId);
            }
        }
        
        // تنظيف المؤقتات القديمة
        for (const [username, timer] of callInterruptionTimers.entries()) {
            if (timer && timer.expiry && now > timer.expiry) {
                clearTimeout(timer.timeout);
                callInterruptionTimers.delete(username);
            }
        }
    }, 600000);
    
    cleanupIntervals.set('cleanup', interval);
}

function cleanupAllIntervals() {
    for (const [name, interval] of cleanupIntervals.entries()) {
        clearInterval(interval);
        console.log(`🧹 تم تنظيف المؤقت: ${name}`);
    }
}

startCleanupInterval();

io.on('connection', (socket) => {
    console.log('✅ مستخدم جديد متصل: ' + socket.id);
    
    let registeredUser = null;
    
    // تعيين مؤقت للاتصال
    const connectionTimeout = setTimeout(() => {
        if (socket.connected && !registeredUser) {
            console.log(`⏰ مهلة الاتصال للمستخدم ${socket.id} - لم يتم التسجيل`);
            socket.emit('connection-timeout', { 
                message: 'انتهت مهلة الاتصال، جاري إعادة التحميل...',
                shouldReload: true
            });
            setTimeout(() => {
                if (socket.connected) socket.disconnect(true);
            }, 1000);
        }
    }, 15000);
    
    // ==================== تسجيل المستخدم مع حفظ الحالة ====================
    socket.on('register user', (userData) => {
        clearTimeout(connectionTimeout);
        
        const { username, userId, savedState } = userData;
        registeredUser = { username, userId };
        
        connectedUsers.set(socket.id, { username, userId });
        
        // إزالة أي اتصال سابق لنفس المستخدم
        if (userSockets.has(username)) {
            const oldSocketId = userSockets.get(username);
            if (oldSocketId !== socket.id) {
                const oldSocket = io.sockets.sockets.get(oldSocketId);
                if (oldSocket && oldSocket.connected) {
                    console.log(`🔌 إغلاق الاتصال القديم للمستخدم ${username}`);
                    oldSocket.emit('force-reload', { 
                        reason: 'new_connection',
                        message: 'تم فتح البرنامج في نافذة أخرى، جاري تحديث هذه النافذة...'
                    });
                    setTimeout(() => oldSocket.disconnect(true), 500);
                }
            }
        }
        
        userSockets.set(username, socket.id);
        
        // استعادة الحالة المحفوظة إذا كانت موجودة
        if (savedState) {
            console.log(`💾 استعادة الحالة المحفوظة للمستخدم ${username}`);
        }
        
        const contactsData = readContacts();
        const contact = contactsData.contacts.find(c => c.name === username);
        if (contact) {
            contact.status = 'online';
            saveContacts(contactsData);
        }
        
        socket.broadcast.emit('user status change', { username, status: 'online' });
        console.log(`📱 المستخدم ${username} سجل الدخول`);
        
        // إرسال قائمة جهات الاتصال
        socket.emit('contacts list', { contacts: contactsData.contacts });
        
        // إرسال إعدادات الرنين
        const ringtoneSettings = readUserSettings(username);
        socket.emit('ringtone settings', { settings: ringtoneSettings });
        
        // إرسال تأكيد التسجيل
        socket.emit('registration-confirmed', { 
            username, 
            timestamp: Date.now(),
            savedState: savedState || null
        });
        
        // إلغاء أي مؤقتات انقطاع سابقة لهذا المستخدم
        if (callInterruptionTimers.has(username)) {
            const timer = callInterruptionTimers.get(username);
            if (timer && timer.timeout) {
                clearTimeout(timer.timeout);
            }
            callInterruptionTimers.delete(username);
        }
    });
    
    // ==================== أحداث مكالمة الفيديو مع الرنين المحسن ====================
    
    socket.on('video-call-init', (data) => {
        const { to, quality = 'high', videoEnabled = true, audioEnabled = true } = data;
        const targetSocketId = userSockets.get(to);
        const fromUser = connectedUsers.get(socket.id);
        
        if (targetSocketId && fromUser) {
            const callId = `${fromUser.username}_${to}_${Date.now()}`;
            const qualityConfig = getVideoQualityConfig(quality);
            
            const targetSettings = readUserSettings(to);
            
            activeCalls.set(callId, {
                from: fromUser.username,
                to: to,
                quality: quality,
                qualityConfig: qualityConfig,
                startTime: Date.now(),
                videoEnabled: videoEnabled,
                audioEnabled: audioEnabled,
                ringtone: targetSettings.ringtone,
                volume: targetSettings.volume,
                ringtoneFile: targetSettings.ringtoneFile
            });
            
            console.log(`📹 بدء مكالمة من ${fromUser.username} إلى ${to} بجودة ${quality}`);
            console.log(`🔔 تشغيل رنة للمستخدم ${to}: ${targetSettings.ringtoneFile || 'default'} (مستوى الصوت: ${targetSettings.volume}%)`);
            
            // 🔥 إرسال رنين للمتصل (outgoing call sound)
            socket.emit('outgoing-call', {
                to: to,
                callId: callId,
                message: `جاري الاتصال بـ ${to}...`
            });
            
            // إرسال إشعار المكالمة مع معلومات الرنين للمستقبل
            io.to(targetSocketId).emit('video-call-init', {
                from: fromUser.username,
                quality: quality,
                qualityConfig: qualityConfig,
                videoEnabled: videoEnabled,
                audioEnabled: audioEnabled,
                callId: callId,
                ringtone: targetSettings.ringtone,
                ringtoneFile: targetSettings.ringtoneFile,
                volume: targetSettings.volume,
                vibrate: targetSettings.vibrate
            });
        } else {
            socket.emit('video-call-error', { 
                message: 'المستخدم غير متصل',
                code: 'user_offline'
            });
        }
    });
    
    socket.on('video-call-offer', (data) => {
        const { to, offer, quality, callId } = data;
        const targetSocketId = userSockets.get(to);
        const fromUser = connectedUsers.get(socket.id);
        
        if (targetSocketId && fromUser) {
            io.to(targetSocketId).emit('video-call-offer', {
                from: fromUser.username,
                offer: offer,
                quality: quality,
                callId: callId
            });
            
            if (callId && activeCalls.has(callId)) {
                const callInfo = activeCalls.get(callId);
                callInfo.offerSent = true;
                activeCalls.set(callId, callInfo);
            }
        }
    });
    
    socket.on('video-call-answer', (data) => {
        const { to, answer, callId } = data;
        const targetSocketId = userSockets.get(to);
        const fromUser = connectedUsers.get(socket.id);
        
        if (targetSocketId && fromUser) {
            // 🔥 إيقاف الرنين للطرفين عند قبول المكالمة
            io.to(targetSocketId).emit('stop-ringtone', { callId, reason: 'answered' });
            socket.emit('stop-ringtone', { callId, reason: 'answered' });
            
            io.to(targetSocketId).emit('video-call-answer', {
                from: fromUser.username,
                answer: answer,
                callId: callId
            });
            
            if (callId && activeCalls.has(callId)) {
                const callInfo = activeCalls.get(callId);
                callInfo.answered = true;
                callInfo.answeredAt = Date.now();
                activeCalls.set(callId, callInfo);
            }
        }
    });
    
    socket.on('video-call-ice', (data) => {
        const { to, candidate, callId } = data;
        const targetSocketId = userSockets.get(to);
        const fromUser = connectedUsers.get(socket.id);
        
        if (targetSocketId && fromUser) {
            io.to(targetSocketId).emit('video-call-ice', {
                from: fromUser.username,
                candidate: candidate,
                callId: callId
            });
        }
    });
    
    socket.on('video-call-end', (data) => {
        const { to, callId, reason } = data;
        const targetSocketId = userSockets.get(to);
        const fromUser = connectedUsers.get(socket.id);
        
        if (targetSocketId && fromUser) {
            console.log(`📹 إنهاء المكالمة بين ${fromUser.username} و ${to}`);
            
            // 🔥 إيقاف الرنين للطرفين عند إنهاء المكالمة
            io.to(targetSocketId).emit('stop-ringtone', { callId, reason: 'ended' });
            socket.emit('stop-ringtone', { callId, reason: 'ended' });
            
            if (callId && activeCalls.has(callId)) {
                const callInfo = activeCalls.get(callId);
                const duration = Date.now() - callInfo.startTime;
                console.log(`⏱️ مدة المكالمة: ${Math.floor(duration / 1000)} ثانية`);
                activeCalls.delete(callId);
            }
            
            io.to(targetSocketId).emit('video-call-end', { 
                from: fromUser.username, 
                callId: callId,
                reason: reason || 'ended'
            });
        }
    });
    
    socket.on('video-call-reject', (data) => {
        const { to, callId } = data;
        const targetSocketId = userSockets.get(to);
        const fromUser = connectedUsers.get(socket.id);
        
        if (targetSocketId && fromUser) {
            console.log(`📹 رفض المكالمة من ${fromUser.username} إلى ${to}`);
            
            // 🔥 إيقاف الرنين للطرفين عند رفض المكالمة
            io.to(targetSocketId).emit('stop-ringtone', { callId, reason: 'rejected' });
            socket.emit('stop-ringtone', { callId, reason: 'rejected' });
            
            if (callId && activeCalls.has(callId)) {
                activeCalls.delete(callId);
            }
            
            io.to(targetSocketId).emit('video-call-reject', { 
                from: fromUser.username, 
                callId: callId 
            });
        }
    });
    
    // ==================== أحداث الرسائل ====================
    
    socket.on('private message', (data) => {
        const { from, to, message, timestamp, messageId } = data;
        
        const messagesData = readPrivateMessages();
        const conversationKey = getConversationId(from, to);
        
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
        
        socket.emit('message sent', { messageId, status: 'sent' });
    });
    
    socket.on('send file', (data) => {
        const { from, to, fileUrl, fileName, fileType, timestamp, messageId } = data;
        
        const messagesData = readPrivateMessages();
        const conversationKey = getConversationId(from, to);
        
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
    });
    
    socket.on('voice message', (data) => {
        const { from, to, audioUrl, duration, timestamp, messageId } = data;
        
        const messagesData = readPrivateMessages();
        const conversationKey = getConversationId(from, to);
        
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
    });
    
    socket.on('update ringtone settings', (data) => {
        const { username, settings } = data;
        if (username && settings) {
            const success = saveUserSettings(username, settings);
            if (success) {
                console.log(`🔔 تم تحديث إعدادات الرنين للمستخدم ${username}`);
                socket.emit('ringtone settings updated', { success: true });
            }
        }
    });
    
    // ==================== معالجة قطع الاتصال مع إعادة تحميل كاملة ====================
    
    socket.on('disconnect', (reason) => {
        const userInfo = connectedUsers.get(socket.id);
        
        if (userInfo) {
            const { username, userId } = userInfo;
            console.log(`⚠️ انقطاع المستخدم ${username}: ${reason}`);
            
            // التحقق مما إذا كان الانقطاع بسبب مشكلة في الاتصال
            const isConnectionIssue = [
                'transport close',
                'transport error',
                'ping timeout',
                'server namespace disconnect',
                'client namespace disconnect'
            ].includes(reason);
            
            // إنهاء جميع المكالمات النشطة للمستخدم وإيقاف الرنين
            const userCalls = [];
            for (const [callId, callInfo] of activeCalls.entries()) {
                if (callInfo.from === username || callInfo.to === username) {
                    userCalls.push({ callId, callInfo });
                }
            }
            
            if (userCalls.length > 0) {
                console.log(`📹 إنهاء ${userCalls.length} مكالمة نشطة للمستخدم ${username}`);
                
                for (const { callId, callInfo } of userCalls) {
                    const otherUser = callInfo.from === username ? callInfo.to : callInfo.from;
                    const otherSocketId = userSockets.get(otherUser);
                    
                    if (otherSocketId && isConnectionIssue) {
                        // 🔥 إيقاف الرنين للطرف الآخر
                        io.to(otherSocketId).emit('stop-ringtone', { callId, reason: 'disconnected' });
                        
                        // إعلام الطرف الآخر بقطع الاتصال وإعادة التحميل
                        io.to(otherSocketId).emit('call-interrupted', {
                            user: username,
                            callId: callId,
                            reason: 'disconnected',
                            message: 'انقطع الاتصال بالمستخدم الآخر، سيتم تحديث الصفحة للحفاظ على الاستقرار...',
                            shouldReload: true
                        });
                        
                        // إرسال أمر إعادة تحميل للطرف الآخر بعد 1.5 ثانية
                        setTimeout(() => {
                            const otherSocket = io.sockets.sockets.get(otherSocketId);
                            if (otherSocket && otherSocket.connected) {
                                otherSocket.emit('force-reload', {
                                    reason: 'call_interrupted',
                                    message: 'تم إنهاء المكالمة بسبب انقطاع الاتصال، جاري تحديث الصفحة...',
                                    preserveState: true
                                });
                            }
                        }, 1500);
                    }
                    
                    activeCalls.delete(callId);
                }
            }
            
            // تحديث حالة المستخدم في جهات الاتصال
            const contactsData = readContacts();
            const contact = contactsData.contacts.find(c => c.name === username);
            if (contact) {
                contact.status = 'offline';
                saveContacts(contactsData);
            }
            
            // إزالة المستخدم من قائمة المتصلين
            if (userSockets.get(username) === socket.id) {
                userSockets.delete(username);
                io.emit('user status change', { username, status: 'offline' });
            }
            
            // حفظ حالة المستخدم قبل قطع الاتصال (للاستعادة بعد إعادة التحميل)
            if (isConnectionIssue) {
                const currentSettings = readUserSettings(username);
                const sessionState = {
                    username: username,
                    settings: currentSettings,
                    disconnectedAt: new Date().toISOString(),
                    reason: reason
                };
                saveUserSession(username, sessionState);
                console.log(`💾 تم حفظ حالة المستخدم ${username} لاستعادتها بعد إعادة التحميل`);
            }
            
            // إعداد مؤقت لإعادة تحميل صفحة المستخدم المنقطع
            if (isConnectionIssue && username) {
                if (callInterruptionTimers.has(username)) {
                    const oldTimer = callInterruptionTimers.get(username);
                    if (oldTimer && oldTimer.timeout) {
                        clearTimeout(oldTimer.timeout);
                    }
                }
                
                const reloadTimer = setTimeout(() => {
                    console.log(`🔄 إرسال أمر إعادة تحميل للمستخدم ${username} بعد انقطاع الاتصال`);
                    // محاولة إرسال أمر إعادة تحميل للمستخدم إذا عاد الاتصال
                    const newSocketId = userSockets.get(username);
                    if (newSocketId) {
                        const newSocket = io.sockets.sockets.get(newSocketId);
                        if (newSocket && newSocket.connected) {
                            newSocket.emit('force-reload', {
                                reason: 'connection_recovery',
                                message: 'تم استعادة الاتصال، جاري تحديث الصفحة...',
                                preserveState: true
                            });
                        }
                    }
                    callInterruptionTimers.delete(username);
                }, 5000);
                
                callInterruptionTimers.set(username, {
                    timeout: reloadTimer,
                    expiry: Date.now() + 5000,
                    username: username
                });
            }
            
            connectedUsers.delete(socket.id);
        }
    });
    
    // ==================== طلب حفظ الحالة ====================
    socket.on('save-current-state', (data) => {
        const { username, state } = data;
        if (username && state) {
            saveUserSession(username, state);
            socket.emit('state-saved', { success: true, timestamp: Date.now() });
        }
    });
    
    // ==================== حدث إعادة التحميل القسري ====================
    socket.on('ready-for-reload', (data) => {
        const { username } = data;
        console.log(`✅ المستخدم ${username} جاهز لإعادة التحميل`);
        socket.emit('perform-reload', {
            timestamp: Date.now(),
            preserveState: true
        });
    });
    
    // ==================== التحقق من صحة الاتصال ====================
    socket.on('connection-health-check', (callback) => {
        if (callback) {
            callback({ 
                status: 'healthy', 
                timestamp: Date.now(),
                socketId: socket.id
            });
        }
    });
    
    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
        
        // إرسال أمر إعادة تحميل عند حدوث خطأ في Socket
        const userInfo = connectedUsers.get(socket.id);
        if (userInfo) {
            socket.emit('force-reload', {
                reason: 'socket_error',
                message: 'حدث خطأ في الاتصال، جاري تحديث الصفحة...',
                preserveState: true
            });
        }
    });
});

// ==================== الصفحات الرئيسية ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// ==================== إغلاق الخادم بشكل آمن ====================
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n🛑 استلام إشارة ${signal}، جاري الإغلاق الآمن...`);
    
    // تنظيف جميع المؤقتات
    cleanupAllIntervals();
    
    for (const [username, timer] of callInterruptionTimers.entries()) {
        if (timer && timer.timeout) {
            clearTimeout(timer.timeout);
        }
    }
    callInterruptionTimers.clear();
    
    io.close(() => {
        console.log('✅ تم إغلاق جميع اتصالات Socket.IO');
        
        server.close(() => {
            console.log('✅ تم إغلاق خادم HTTP');
            
            if (fs.existsSync(uploadsDir)) {
                fs.rmSync(uploadsDir, { recursive: true, force: true });
                console.log('🧹 تم حذف الملفات المؤقتة');
            }
            
            console.log('🛑 تم إغلاق الخادم بنجاح');
            process.exit(0);
        });
    });
    
    setTimeout(() => {
        console.error('⚠️ مهلة الإغلاق، إغلاق إجباري');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ رفض غير معالج:', reason);
});

// ==================== تشغيل الخادم ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 الخادم يعمل بنجاح!`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`☁️  Cloudinary جاهز لاستقبال الملفات`);
    console.log(`📁 مجلد رفع الملفات المؤقت: ${uploadsDir}`);
    console.log(`\n📹 ميزات المكالمات المحسنة:`);
    console.log(`   - جودة فيديو قابلة للتعديل`);
    console.log(`   - التحكم في الكاميرا والصوت أثناء المكالمة`);
    console.log(`   - حساب مدة المكالمات`);
    console.log(`\n🔔 ميزات الرنين المحسنة:`);
    console.log(`   - رنين للمتصل عند بدء المكالمة (outgoing-call)`);
    console.log(`   - رنين للمستقبل مع نغمات متعددة (video-call-init)`);
    console.log(`   - إيقاف الرنين عند: القبول، الرفض، الإنهاء، الانقطاع`);
    console.log(`   - إعدادات منفصلة لكل مستخدم`);
    console.log(`   - التحكم في مستوى الصوت والاهتزاز`);
    console.log(`\n🔄 ميزات معالجة قطع الاتصال المحسنة:`);
    console.log(`   - تحديث تلقائي للصفحة عند انقطاع المكالمة`);
    console.log(`   - حفظ حالة المستخدم قبل الانقطاع`);
    console.log(`   - استعادة الإعدادات بعد إعادة التحميل`);
    console.log(`   - إشعار فوري للطرف الآخر بقطع الاتصال`);
    console.log(`   - إيقاف الرنين تلقائياً عند الانقطاع`);
    console.log(`   - منع تكرار الجلسات المتعددة`);
    console.log(`========================================\n`);
});
