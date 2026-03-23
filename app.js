// استدعاء المكتبات اللازمة
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

// إعداد الخادم
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تحديد المجلد الذي يحتوي على ملفات الواجهة الأمامية
//app.use(express.static(__dirname + '/public'));
app.use(express.static(__dirname));

app.use(express.json());

// مسار ملفات البيانات
const codesFilePath = path.join(__dirname, 'access_codes.json');
const contactsFilePath = path.join(__dirname, 'contacts.json');
const privateMessagesPath = path.join(__dirname, 'private_messages.json');

// ==================== إدارة رموز الدخول ====================
function readAccessCodes() {
    try {
        if (fs.existsSync(codesFilePath)) {
            const data = fs.readFileSync(codesFilePath, 'utf8');
            return JSON.parse(data);
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

// ==================== إدارة جهات الاتصال ====================
function readContacts() {
    try {
        if (fs.existsSync(contactsFilePath)) {
            const data = fs.readFileSync(contactsFilePath, 'utf8');
            return JSON.parse(data);
        } else {
            // جهات اتصال افتراضية
            const defaultContacts = {
                contacts: [
                    { id: "1", name: "أحمد محمد", phone: "0501111111", avatar: "A", status: "online" },
                    { id: "2", name: "سارة أحمد", phone: "0502222222", avatar: "S", status: "offline" },
                    { id: "3", name: "محمد علي", phone: "0503333333", avatar: "M", status: "online" },
                    { id: "4", name: "فاطمة حسن", phone: "0504444444", avatar: "F", status: "offline" },
                    { id: "5", name: "عبدالله عمر", phone: "0505555555", avatar: "A", status: "online" }
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

// ==================== إدارة الرسائل الخاصة ====================
function readPrivateMessages() {
    try {
        if (fs.existsSync(privateMessagesPath)) {
            const data = fs.readFileSync(privateMessagesPath, 'utf8');
            return JSON.parse(data);
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

// التحقق من رمز الدخول
app.post('/verify-code', (req, res) => {
    const { code } = req.body;
    const codesData = readAccessCodes();
    
    if (codesData.codes.includes(code)) {
        res.json({ success: true, message: 'تم التحقق بنجاح' });
    } else {
        res.json({ success: false, message: 'رمز غير صحيح' });
    }
});

// إضافة رمز دخول جديد
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

// إزالة رمز دخول
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

// عرض جميع الرموز
app.get('/get-codes', (req, res) => {
    const codesData = readAccessCodes();
    res.json(codesData);
});

// عرض جهات الاتصال
app.get('/get-contacts', (req, res) => {
    const contactsData = readContacts();
    res.json(contactsData);
});

// إضافة جهة اتصال جديدة
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

// حذف جهة اتصال
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

// الحصول على محادثة خاصة
app.post('/get-conversation', (req, res) => {
    const { userId, contactId } = req.body;
    const messagesData = readPrivateMessages();
    const conversationKey = [userId, contactId].sort().join('_');
    
    const conversation = messagesData.conversations[conversationKey] || [];
    res.json({ messages: conversation });
});

// تحديث حالة المستخدم (متصل/غير متصل)
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

// تخزين المستخدمين المتصلين
const connectedUsers = new Map(); // socket.id -> { userId, username }
const userSockets = new Map(); // userId -> socket.id

// ==================== Socket.IO Events ====================
io.on('connection', (socket) => {
    console.log('مُستخدِمٌ جديدٌ مُتَّصِل: ' + socket.id);
    
    // تسجيل دخول المستخدم
    socket.on('register user', (userData) => {
        const { username, userId } = userData;
        connectedUsers.set(socket.id, { username, userId });
        userSockets.set(username, socket.id);
        
        // تحديث حالة المستخدم إلى متصل
        updateUserStatus(username, 'online');
        
        // إعلام جميع المستخدمين بتحديث حالة الاتصال
        io.emit('user status change', { username, status: 'online' });
        
        console.log(`المستخدم ${username} سجل الدخول`);
    });
    
    // إرسال رسالة خاصة
    socket.on('private message', (data) => {
        const { from, to, message, timestamp } = data;
        
        // حفظ الرسالة في الملف
        const messagesData = readPrivateMessages();
        const conversationKey = [from, to].sort().join('_');
        
        if (!messagesData.conversations[conversationKey]) {
            messagesData.conversations[conversationKey] = [];
        }
        
        const messageObj = {
            id: Date.now(),
            from: from,
            to: to,
            message: message,
            timestamp: timestamp,
            read: false
        };
        
        messagesData.conversations[conversationKey].push(messageObj);
        savePrivateMessages(messagesData);
        
        // إرسال الرسالة للمستقبل إذا كان متصلاً
        const recipientSocketId = userSockets.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private message', {
                from: from,
                message: message,
                timestamp: timestamp,
                isUnread: false
            });
        }
        
        // إرسال تأكيد للمرسل
        socket.emit('message sent', { success: true, to: to });
        
        // تحديث عدد الرسائل غير المقروءة للمستقبل
        updateUnreadCount(to);
    });
    
    // تحديث حالة قراءة الرسائل
    socket.on('mark messages read', (data) => {
        const { userId, contactId } = data;
        const messagesData = readPrivateMessages();
        const conversationKey = [userId, contactId].sort().join('_');
        
        if (messagesData.conversations[conversationKey]) {
            messagesData.conversations[conversationKey].forEach(msg => {
                if (msg.to === userId && !msg.read) {
                    msg.read = true;
                }
            });
            savePrivateMessages(messagesData);
        }
    });
    
    // عند انقطاع الاتصال
    socket.on('disconnect', () => {
        const userInfo = connectedUsers.get(socket.id);
        if (userInfo) {
            updateUserStatus(userInfo.username, 'offline');
            io.emit('user status change', { username: userInfo.username, status: 'offline' });
            userSockets.delete(userInfo.username);
        }
        console.log(`مُستخدِمٌ غادَرَ: ${socket.id}`);
        connectedUsers.delete(socket.id);
    });
});

// دالة تحديث حالة المستخدم
function updateUserStatus(username, status) {
    const contactsData = readContacts();
    const contact = contactsData.contacts.find(c => c.name === username);
    if (contact) {
        contact.status = status;
        saveContacts(contactsData);
    }
}

// دالة تحديث عدد الرسائل غير المقروءة
function updateUnreadCount(username) {
    const messagesData = readPrivateMessages();
    let unreadCount = 0;
    
    for (const [key, messages] of Object.entries(messagesData.conversations)) {
        unreadCount += messages.filter(msg => msg.to === username && !msg.read).length;
    }
    
    const recipientSocketId = userSockets.get(username);
    if (recipientSocketId) {
        io.to(recipientSocketId).emit('unread count update', unreadCount);
    }
}

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`الخادمُ يعملُ بنجاحٍ على الرابط: http://localhost:${PORT}`);
});
