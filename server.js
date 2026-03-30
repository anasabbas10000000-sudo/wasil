const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dezprpy5q',
    api_key: process.env.CLOUDINARY_API_KEY || '462762935819578',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'vV6GrKIp-VBifpafhdz4Bs82xdA'
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    allowEIO3: true,
    upgradeTimeout: 15000,
    maxHttpBufferSize: 1e8,
    perMessageDeflate: false
});

app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg','image/png','image/gif','image/webp',
            'video/mp4','video/webm','video/quicktime','video/x-m4v',
            'audio/webm','audio/mpeg','audio/mp3','audio/mp4',
            'audio/ogg','audio/wav','audio/x-m4a','audio/aac',
            'application/pdf','application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        cb(null, allowed.includes(file.mimetype));
    }
});

async function uploadToCloudinary(buffer, originalName, mimetype) {
    return new Promise((resolve, reject) => {
        let resourceType = 'auto';
        if (mimetype.startsWith('image/')) resourceType = 'image';
        else if (mimetype.startsWith('video/')) resourceType = 'video';
        else if (mimetype.startsWith('audio/')) resourceType = 'raw';
        else resourceType = 'raw';

        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: resourceType,
                folder: 'wasil_uploads',
                public_id: `${Date.now()}_${originalName.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_')}`,
                timeout: 120000
            },
            (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(buffer);
    });
}

async function handleFileUpload(req, res) {
    if (!req.file) return res.status(400).json({ success: false, message: 'لم يتم رفع أي ملف' });
    try {
        const result = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.file.mimetype);
        res.json({
            success: true,
            fileUrl: result.secure_url,
            fileName: req.file.originalname,
            fileType: req.file.mimetype,
            fileSize: req.file.size,
            publicId: result.public_id
        });
    } catch(e) {
        res.status(500).json({ success: false, message: 'خطأ في الرفع: ' + e.message });
    }
}

app.post('/upload-file', upload.single('file'), handleFileUpload);
app.post('/api/upload', upload.single('file'), handleFileUpload);
app.post('/upload', upload.single('file'), handleFileUpload);
app.use('/uploads', express.static(uploadsDir));

const codesFilePath = path.join(__dirname, 'access_codes.json');
const contactsFilePath = path.join(__dirname, 'contacts.json');
const privateMessagesPath = path.join(__dirname, 'private_messages.json');
const settingsFilePath = path.join(__dirname, 'user_settings.json');
const sessionFilePath = path.join(__dirname, 'user_sessions.json');
const oauthUsersPath = path.join(__dirname, 'oauth_users.json');
const usersFilePath = path.join(__dirname, 'users.json');
const bannedUsersFilePath = path.join(__dirname, 'banned_users.json');

function readJSON(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
        return defaultValue;
    } catch(e) { return defaultValue; }
}

function writeJSON(filePath, data) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); return true; }
    catch(e) { console.error('Write error:', e); return false; }
}

function readContacts() {
    return readJSON(contactsFilePath, {
        contacts: [
            { id:'1', name:'أحمد محمد', phone:'0501111111', avatar:'أ', status:'offline' },
            { id:'2', name:'سارة أحمد', phone:'0502222222', avatar:'س', status:'offline' },
            { id:'3', name:'محمد علي', phone:'0503333333', avatar:'م', status:'offline' },
            { id:'4', name:'فاطمة حسن', phone:'0504444444', avatar:'ف', status:'offline' },
            { id:'5', name:'عبدالله عمر', phone:'0505555555', avatar:'ع', status:'offline' }
        ]
    });
}

function readPrivateMessages() {
    return readJSON(privateMessagesPath, { conversations: {} });
}

function readUserSettings(username) {
    const all = readJSON(settingsFilePath, {});
    return all[username] || {
        ringtone:'default', volume:80, vibrate:true,
        ringtoneFile:'default', videoQuality:'high',
        cameraEnabled:true, micEnabled:true, theme:'light', language:'ar'
    };
}

function saveUserSettings(username, settings) {
    const all = readJSON(settingsFilePath, {});
    all[username] = settings;
    return writeJSON(settingsFilePath, all);
}

function saveUserSession(username, state) {
    const sessions = readJSON(sessionFilePath, {});
    sessions[username] = { ...state, lastUpdated: new Date().toISOString() };
    return writeJSON(sessionFilePath, sessions);
}

function getUserSession(username) {
    const sessions = readJSON(sessionFilePath, {});
    return sessions[username] || null;
}

function getConversationId(u1, u2) { return [u1, u2].sort().join('_'); }

function readOAuthUsers() {
    return readJSON(oauthUsersPath, { users: [] });
}

function saveOAuthUser(profile) {
    const data = readOAuthUsers();
    const existing = data.users.find(u => u.id === profile.id && u.provider === profile.provider);
    if (!existing) {
        data.users.push({ ...profile, createdAt: new Date().toISOString() });
        const cd = readContacts();
        if (!cd.contacts.find(c => c.name === profile.username)) {
            cd.contacts.push({
                id: profile.id,
                name: profile.username,
                phone: '',
                avatar: profile.username.charAt(0).toUpperCase(),
                status: 'offline',
                provider: profile.provider
            });
            writeJSON(contactsFilePath, cd);
        }
        const usersData = readJSON(usersFilePath, { users: [] });
        if (!usersData.users.find(u => u.username === profile.username)) {
            usersData.users.push({
                username: profile.username,
                email: profile.email || '',
                phone: '',
                registeredAt: new Date().toISOString(),
                provider: profile.provider
            });
            writeJSON(usersFilePath, usersData);
        }
    } else {
        existing.lastLogin = new Date().toISOString();
    }
    writeJSON(oauthUsersPath, data);
    return data.users.find(u => u.id === profile.id && u.provider === profile.provider);
}

app.post('/verify-code', (req, res) => {
    const codes = readJSON(codesFilePath, { codes: ['1234', '5678'] });
    res.json(codes.codes.includes(req.body.code)
        ? { success: true }
        : { success: false, message: 'رمز غير صحيح' });
});

app.post('/auth/oauth-login', (req, res) => {
    const { provider, token, profile } = req.body;
    if (!provider || !profile || !profile.username) {
        return res.status(400).json({ success: false, message: 'بيانات OAuth غير صحيحة' });
    }
    try {
        const user = saveOAuthUser({ ...profile, provider, token });
        res.json({ success: true, username: user.username, userId: user.id, provider });
    } catch(e) {
        res.status(500).json({ success: false, message: 'خطأ في تسجيل الدخول' });
    }
});

app.post('/auth/check-user', (req, res) => {
    const { provider, id } = req.body;
    const data = readOAuthUsers();
    const user = data.users.find(u => u.id === id && u.provider === provider);
    res.json({ success: !!user, user: user || null });
});

app.get('/get-contacts', (req, res) => res.json(readContacts()));

app.post('/add-contact', (req, res) => {
    const d = readContacts();
    const c = { id: Date.now().toString(), name: req.body.name, phone: req.body.phone, avatar: req.body.name.charAt(0), status: 'offline' };
    d.contacts.push(c);
    writeJSON(contactsFilePath, d);
    res.json({ success: true, contact: c });
});

app.post('/delete-contact', (req, res) => {
    const d = readContacts();
    const i = d.contacts.findIndex(c => c.id === req.body.contactId);
    if (i !== -1) { d.contacts.splice(i, 1); writeJSON(contactsFilePath, d); res.json({ success: true }); }
    else res.json({ success: false });
});

app.post('/get-conversation', (req, res) => {
    const d = readPrivateMessages();
    const key = getConversationId(req.body.userId, req.body.contactId);
    res.json({ messages: d.conversations[key] || [] });
});

app.post('/cleanup-messages', (req, res) => {
    const { username, days } = req.body;
    if (!days || days <= 0) return res.json({ success: true, cleanedCount: 0 });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const d = readPrivateMessages(); let count = 0;
    for (const key of Object.keys(d.conversations)) {
        const orig = d.conversations[key].length;
        d.conversations[key] = d.conversations[key].filter(m => new Date(m.timestamp) > cutoff);
        count += orig - d.conversations[key].length;
    }
    writeJSON(privateMessagesPath, d);
    res.json({ success: true, cleanedCount: count });
});

app.post('/update-status', (req, res) => {
    const d = readContacts();
    const c = d.contacts.find(c => c.id === req.body.userId || c.name === req.body.userId);
    if (c) { c.status = req.body.status; writeJSON(contactsFilePath, d); res.json({ success: true }); }
    else res.json({ success: false });
});

app.get('/get-ringtone-settings', (req, res) => {
    if (!req.query.username) return res.status(400).json({ success: false });
    res.json({ success: true, settings: readUserSettings(req.query.username) });
});

app.post('/update-ringtone-settings', (req, res) => {
    const { username, settings } = req.body;
    if (!username || !settings) return res.status(400).json({ success: false });
    res.json({ success: saveUserSettings(username, settings) });
});

app.post('/save-user-state', (req, res) => {
    const { username, state } = req.body;
    res.json({ success: username && state ? saveUserSession(username, state) : false });
});

app.get('/get-user-state', (req, res) => {
    res.json({ success: true, state: getUserSession(req.query.username) });
});

app.post('/delete-message', (req, res) => {
    const { userId, contactId, messageId } = req.body;
    const d = readPrivateMessages();
    const key = getConversationId(userId, contactId);
    if (d.conversations[key]) {
        d.conversations[key] = d.conversations[key].filter(m => m.id !== messageId);
        writeJSON(privateMessagesPath, d);
    }
    res.json({ success: true });
});

app.get('/available-ringtones', (req, res) => {
    const dir = path.join(__dirname, 'ringtones');
    let ringtones = ['default', 'calling'];
    try {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter(f => /\.(mp3|wav|ogg)$/.test(f));
            files.forEach(f => {
                const name = f.replace(/\.[^/.]+$/, '');
                if (!ringtones.includes(name)) ringtones.push(name);
            });
        }
    } catch(e) {}
    res.json({ success: true, ringtones });
});

const ADMIN_PASSWORD = 'admin123';

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'كلمة مرور غير صحيحة' });
    }
});

app.get('/api/admin/users', (req, res) => {
    const usersData = readJSON(usersFilePath, { users: [] });
    const bannedData = readJSON(bannedUsersFilePath, { banned: [] });
    const contacts = readContacts();
    const allUsers = [];
    const userMap = new Map();
    contacts.contacts.forEach(contact => {
        const isBanned = bannedData.banned.find(b => b.username === contact.name);
        userMap.set(contact.name, {
            username: contact.name,
            phone: contact.phone,
            status: contact.status || 'offline',
            avatar: contact.avatar,
            banned: !!isBanned,
            banReason: isBanned?.reason,
            lastActive: contact.lastActive || null,
            email: ''
        });
    });
    usersData.users.forEach(user => {
        if (userMap.has(user.username)) {
            const existing = userMap.get(user.username);
            existing.email = user.email || '';
            existing.registeredAt = user.registeredAt;
        } else {
            const isBanned = bannedData.banned.find(b => b.username === user.username);
            userMap.set(user.username, {
                username: user.username,
                phone: user.phone || '',
                status: 'offline',
                avatar: user.username.charAt(0).toUpperCase(),
                banned: !!isBanned,
                banReason: isBanned?.reason,
                lastActive: null,
                email: user.email || '',
                registeredAt: user.registeredAt
            });
        }
    });
    const users = Array.from(userMap.values());
    const stats = {
        total: users.length,
        online: users.filter(u => u.status === 'online').length,
        banned: users.filter(u => u.banned).length
    };
    res.json({ success: true, users, stats });
});

app.post('/api/admin/add-user', (req, res) => {
    const { username, phone } = req.body;
    if (!username) {
        return res.json({ success: false, message: 'اسم المستخدم مطلوب' });
    }
    const contacts = readContacts();
    if (contacts.contacts.find(c => c.name === username)) {
        return res.json({ success: false, message: 'المستخدم موجود بالفعل' });
    }
    const newUser = {
        id: Date.now().toString(),
        name: username,
        phone: phone || '',
        avatar: username.charAt(0).toUpperCase(),
        status: 'offline',
        createdAt: new Date().toISOString()
    };
    contacts.contacts.push(newUser);
    writeJSON(contactsFilePath, contacts);
    const usersData = readJSON(usersFilePath, { users: [] });
    if (!usersData.users.find(u => u.username === username)) {
        usersData.users.push({
            username,
            phone: phone || '',
            registeredAt: new Date().toISOString()
        });
        writeJSON(usersFilePath, usersData);
    }
    res.json({ success: true, user: newUser });
});

app.delete('/api/admin/delete-user/:username', (req, res) => {
    const { username } = req.params;
    const contacts = readContacts();
    const index = contacts.contacts.findIndex(c => c.name === username);
    if (index !== -1) {
        contacts.contacts.splice(index, 1);
        writeJSON(contactsFilePath, contacts);
    }
    const usersData = readJSON(usersFilePath, { users: [] });
    const userIndex = usersData.users.findIndex(u => u.username === username);
    if (userIndex !== -1) {
        usersData.users.splice(userIndex, 1);
        writeJSON(usersFilePath, usersData);
    }
    const bannedData = readJSON(bannedUsersFilePath, { banned: [] });
    const bannedIndex = bannedData.banned.findIndex(b => b.username === username);
    if (bannedIndex !== -1) {
        bannedData.banned.splice(bannedIndex, 1);
        writeJSON(bannedUsersFilePath, bannedData);
    }
    const messages = readPrivateMessages();
    for (const key of Object.keys(messages.conversations)) {
        messages.conversations[key] = messages.conversations[key].filter(m =>
            m.from !== username && m.to !== username
        );
    }
    writeJSON(privateMessagesPath, messages);
    if (userSockets.has(username)) {
        const socketId = userSockets.get(username);
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
            sock.emit('force-reload', { reason: 'account_deleted' });
            sock.disconnect(true);
        }
        userSockets.delete(username);
    }
    res.json({ success: true });
});

app.post('/api/admin/ban-user', (req, res) => {
    const { username, reason } = req.body;
    if (!username) {
        return res.json({ success: false, message: 'اسم المستخدم مطلوب' });
    }
    const bannedData = readJSON(bannedUsersFilePath, { banned: [] });
    if (!bannedData.banned.find(b => b.username === username)) {
        bannedData.banned.push({
            username,
            reason: reason || 'تم الحظر من قبل الإدارة',
            bannedAt: new Date().toISOString(),
            bannedBy: 'admin'
        });
        writeJSON(bannedUsersFilePath, bannedData);
    }
    if (userSockets.has(username)) {
        const socketId = userSockets.get(username);
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
            sock.emit('force-reload', { reason: 'account_banned' });
            sock.disconnect(true);
        }
        userSockets.delete(username);
    }
    res.json({ success: true });
});

app.post('/api/admin/unban-user', (req, res) => {
    const { username } = req.body;
    const bannedData = readJSON(bannedUsersFilePath, { banned: [] });
    const index = bannedData.banned.findIndex(b => b.username === username);
    if (index !== -1) {
        bannedData.banned.splice(index, 1);
        writeJSON(bannedUsersFilePath, bannedData);
    }
    res.json({ success: true });
});

app.get('/api/check-banned', (req, res) => {
    const { username } = req.query;
    const bannedData = readJSON(bannedUsersFilePath, { banned: [] });
    const banned = bannedData.banned.find(b => b.username === username);
    res.json({ banned: !!banned, reason: banned?.reason });
});

app.get('/api/admin/user-messages/:username', (req, res) => {
    const { username } = req.params;
    const messages = readPrivateMessages();
    const userMessages = [];
    for (const [key, msgs] of Object.entries(messages.conversations)) {
        const relatedMsgs = msgs.filter(m => m.from === username || m.to === username);
        userMessages.push(...relatedMsgs);
    }
    userMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ success: true, messages: userMessages });
});

app.post('/api/admin/delete-message', (req, res) => {
    const { messageId, username, otherUser } = req.body;
    const messages = readPrivateMessages();
    for (const key of Object.keys(messages.conversations)) {
        const before = messages.conversations[key].length;
        messages.conversations[key] = messages.conversations[key].filter(m => m.id !== messageId);
        if (before !== messages.conversations[key].length) break;
    }
    writeJSON(privateMessagesPath, messages);
    res.json({ success: true });
});

app.post('/api/admin/clear-conversation', (req, res) => {
    const { username, otherUser } = req.body;
    const messages = readPrivateMessages();
    const key = [username, otherUser].sort().join('_');
    if (messages.conversations[key]) {
        messages.conversations[key] = [];
        writeJSON(privateMessagesPath, messages);
    }
    res.json({ success: true });
});

app.post('/api/admin/send-notification', (req, res) => {
    const { username, message } = req.body;
    if (!username || !message) {
        return res.json({ success: false, message: 'البيانات غير مكتملة' });
    }
    const socketId = userSockets.get(username);
    if (socketId) {
        io.to(socketId).emit('admin-notification', {
            message,
            timestamp: new Date().toISOString(),
            from: 'admin'
        });
        const notificationsFile = path.join(__dirname, 'admin_notifications.json');
        const notifications = readJSON(notificationsFile, { notifications: [] });
        notifications.notifications.push({
            to: username,
            message,
            sentAt: new Date().toISOString()
        });
        writeJSON(notificationsFile, notifications);
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'المستخدم غير متصل حالياً' });
    }
});

app.post('/api/admin/update-status', (req, res) => {
    const { username, status } = req.body;
    const contacts = readContacts();
    const contact = contacts.contacts.find(c => c.name === username);
    if (contact) {
        contact.status = status;
        writeJSON(contactsFilePath, contacts);
        io.emit('user status change', { username, status });
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

const connectedUsers = new Map();
const userSockets = new Map();
const activeCalls = new Map();
const groupCallRooms = new Map();

io.on('connection', (socket) => {
    console.log('🔌 Connected:', socket.id);

    socket.on('register user', (data) => {
        const { username, userId } = data;
        connectedUsers.set(socket.id, { username, userId });
        if (userSockets.has(username)) {
            const oldId = userSockets.get(username);
            if (oldId !== socket.id) {
                const oldSock = io.sockets.sockets.get(oldId);
                if (oldSock?.connected) {
                    oldSock.emit('force-reload', { reason: 'new_connection' });
                    setTimeout(() => oldSock.disconnect(true), 600);
                }
            }
        }
        userSockets.set(username, socket.id);
        const cd = readContacts();
        const contact = cd.contacts.find(c => c.name === username);
        if (contact) { contact.status = 'online'; writeJSON(contactsFilePath, cd); }
        socket.broadcast.emit('user status change', { username, status: 'online' });
        socket.emit('contacts list', { contacts: readContacts().contacts });
        socket.emit('ringtone settings', { settings: readUserSettings(username) });
        socket.emit('registration-confirmed', { username, timestamp: Date.now() });
        console.log(`✅ Registered: ${username}`);
    });

    socket.on('video-call-init', (data) => {
        const { to, quality = 'high', videoEnabled = true, audioEnabled = true } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser) return;
        if (!targetId) {
            return socket.emit('video-call-error', { message: 'المستخدم غير متصل', code: 'user_offline' });
        }
        const callId = `${fromUser.username}_${to}_${Date.now()}`;
        const targetSettings = readUserSettings(to);
        activeCalls.set(callId, {
            from: fromUser.username, to,
            quality, startTime: Date.now(),
            videoEnabled, audioEnabled,
            pendingCandidates: []
        });
        console.log(`📹 Call init: ${fromUser.username} → ${to} [${callId}]`);
        socket.emit('outgoing-call', { to, callId, message: `جاري الاتصال بـ ${to}...` });
        io.to(targetId).emit('video-call-init', {
            from: fromUser.username,
            quality, videoEnabled, audioEnabled,
            callId,
            ringtoneFile: targetSettings.ringtoneFile || 'default',
            volume: targetSettings.volume || 80,
            vibrate: targetSettings.vibrate
        });
    });

    socket.on('video-call-offer', (data) => {
        const { to, offer, quality, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser || !targetId) return;
        if (callId && activeCalls.has(callId)) {
            const info = activeCalls.get(callId);
            info.offerSent = true;
            info.offer = offer;
            activeCalls.set(callId, info);
        }
        console.log(`📤 Offer sent: ${fromUser.username} → ${to}`);
        io.to(targetId).emit('video-call-offer', {
            from: fromUser.username, offer, quality, callId
        });
    });

    socket.on('video-call-answer', (data) => {
        const { to, answer, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser || !targetId) return;
        io.to(targetId).emit('stop-ringtone', { callId, reason: 'answered' });
        socket.emit('stop-ringtone', { callId, reason: 'answered' });
        if (callId && activeCalls.has(callId)) {
            const info = activeCalls.get(callId);
            info.answered = true; info.answeredAt = Date.now();
            activeCalls.set(callId, info);
        }
        console.log(`✅ Call answered: ${fromUser.username} ↔ ${to}`);
        io.to(targetId).emit('video-call-answer', { from: fromUser.username, answer, callId });
        if (callId && activeCalls.has(callId)) {
            const info = activeCalls.get(callId);
            if (info.pendingCandidates && info.pendingCandidates.length > 0) {
                console.log(`📦 Flushing ${info.pendingCandidates.length} buffered ICE candidates`);
                info.pendingCandidates.forEach(candidate => {
                    io.to(targetId).emit('video-call-ice', { from: fromUser.username, candidate, callId });
                });
                info.pendingCandidates = [];
                activeCalls.set(callId, info);
            }
        }
    });

    socket.on('video-call-ice', (data) => {
        const { to, candidate, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser || !candidate) return;
        if (targetId) {
            io.to(targetId).emit('video-call-ice', { from: fromUser.username, candidate, callId });
        }
    });

    socket.on('video-call-end', (data) => {
        const { to, callId, reason } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser) return;
        console.log(`📵 Call ended: ${fromUser.username} → ${to}`);
        if (targetId) {
            io.to(targetId).emit('stop-ringtone', { callId, reason: reason || 'ended' });
            io.to(targetId).emit('video-call-end', { from: fromUser.username, callId, reason: reason || 'ended' });
        }
        socket.emit('stop-ringtone', { callId, reason: reason || 'ended' });
        if (callId && activeCalls.has(callId)) {
            const info = activeCalls.get(callId);
            const duration = Math.floor((Date.now() - info.startTime) / 1000);
            console.log(`⏱️ Duration: ${duration}s`);
            activeCalls.delete(callId);
        }
    });

    socket.on('video-call-reject', (data) => {
        const { to, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser) return;
        console.log(`❌ Call rejected: ${fromUser.username} → ${to}`);
        if (targetId) {
            io.to(targetId).emit('stop-ringtone', { callId, reason: 'rejected' });
            io.to(targetId).emit('video-call-reject', { from: fromUser.username, callId });
        }
        socket.emit('stop-ringtone', { callId, reason: 'rejected' });
        if (callId && activeCalls.has(callId)) activeCalls.delete(callId);
    });

    socket.on('group-call-join', (data) => {
        const { roomId, username } = data;
        const fromUser = connectedUsers.get(socket.id);
        if (!fromUser) return;
        if (!groupCallRooms.has(roomId)) {
            groupCallRooms.set(roomId, { members: new Set(), createdAt: Date.now() });
        }
        const room = groupCallRooms.get(roomId);
        const existingMembers = [...room.members];
        room.members.add(fromUser.username);
        socket.join(`group-${roomId}`);
        console.log(`👥 ${fromUser.username} joined group call ${roomId}`);
        socket.emit('group-call-existing-members', { roomId, members: existingMembers });
        socket.to(`group-${roomId}`).emit('group-call-member-joined', {
            roomId, username: fromUser.username
        });
    });

    socket.on('group-call-offer', (data) => {
        const { roomId, to, offer, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser || !targetId) return;
        io.to(targetId).emit('group-call-offer', {
            roomId, from: fromUser.username, offer, callId
        });
    });

    socket.on('group-call-answer', (data) => {
        const { roomId, to, answer, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser || !targetId) return;
        io.to(targetId).emit('group-call-answer', {
            roomId, from: fromUser.username, answer, callId
        });
    });

    socket.on('group-call-ice', (data) => {
        const { roomId, to, candidate, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser || !targetId || !candidate) return;
        io.to(targetId).emit('group-call-ice', {
            roomId, from: fromUser.username, candidate, callId
        });
    });

    socket.on('group-call-leave', (data) => {
        const { roomId } = data;
        const fromUser = connectedUsers.get(socket.id);
        if (!fromUser) return;
        const room = groupCallRooms.get(roomId);
        if (room) {
            room.members.delete(fromUser.username);
            if (room.members.size === 0) groupCallRooms.delete(roomId);
        }
        socket.leave(`group-${roomId}`);
        socket.to(`group-${roomId}`).emit('group-call-member-left', {
            roomId, username: fromUser.username
        });
        console.log(`👋 ${fromUser.username} left group call ${roomId}`);
    });

    socket.on('group-call-invite', (data) => {
        const { roomId, to, from } = data;
        const targetId = userSockets.get(to);
        const fromUser = connectedUsers.get(socket.id);
        if (!fromUser || !targetId) return;
        const targetSettings = readUserSettings(to);
        io.to(targetId).emit('group-call-invite', {
            roomId, from: fromUser.username,
            ringtoneFile: targetSettings.ringtoneFile || 'default',
            volume: targetSettings.volume || 80,
            vibrate: targetSettings.vibrate
        });
    });

    socket.on('private message', (data) => {
        const { from, to, message, timestamp, messageId } = data;
        const d = readPrivateMessages();
        const key = getConversationId(from, to);
        if (!d.conversations[key]) d.conversations[key] = [];
        d.conversations[key].push({
            id: messageId || Date.now().toString(),
            from, to, message, type: 'text',
            timestamp: timestamp || new Date().toISOString(),
            read: false
        });
        writeJSON(privateMessagesPath, d);
        const recipId = userSockets.get(to);
        if (recipId) io.to(recipId).emit('private message', { from, message, timestamp, messageId });
        socket.emit('message sent', { messageId, status: 'sent' });
    });

    socket.on('send file', (data) => {
        const { from, to, fileUrl, fileName, fileType, timestamp, messageId } = data;
        const d = readPrivateMessages();
        const key = getConversationId(from, to);
        if (!d.conversations[key]) d.conversations[key] = [];
        const isVideo = fileType?.startsWith('video/');
        d.conversations[key].push({
            id: messageId || Date.now().toString(),
            from, to,
            type: isVideo ? 'video' : 'file',
            fileUrl, fileName, fileType,
            ...(isVideo ? { videoUrl: fileUrl } : {}),
            timestamp: timestamp || new Date().toISOString(),
            read: false
        });
        writeJSON(privateMessagesPath, d);
        const recipId = userSockets.get(to);
        if (recipId) io.to(recipId).emit('file received', { from, fileUrl, fileName, fileType, timestamp });
    });

    socket.on('voice message', (data) => {
        const { from, to, audioUrl, duration, timestamp, messageId } = data;
        const d = readPrivateMessages();
        const key = getConversationId(from, to);
        if (!d.conversations[key]) d.conversations[key] = [];
        d.conversations[key].push({
            id: messageId || Date.now().toString(),
            from, to, type: 'voice', audioUrl, duration,
            timestamp: timestamp || new Date().toISOString(),
            read: false
        });
        writeJSON(privateMessagesPath, d);
        const recipId = userSockets.get(to);
        if (recipId) io.to(recipId).emit('voice message', { from, audioUrl, duration, timestamp });
    });

    socket.on('mark message read', (data) => {
        const { userId, messageId, contactId } = data;
        const d = readPrivateMessages();
        const key = getConversationId(userId, contactId);
        const msg = (d.conversations[key] || []).find(m => m.id === messageId);
        if (msg) {
            msg.read = true;
            writeJSON(privateMessagesPath, d);
            const senderSocketId = userSockets.get(contactId);
            if (senderSocketId) io.to(senderSocketId).emit('message read', { messageId });
        }
    });

    socket.on('delete message', (data) => {
        const { messageId, userId, contactId } = data;
        const d = readPrivateMessages();
        const key = getConversationId(userId, contactId);
        if (d.conversations[key]) {
            d.conversations[key] = d.conversations[key].filter(m => m.id !== messageId);
            writeJSON(privateMessagesPath, d);
        }
    });

    socket.on('typing', (data) => {
        const recipId = userSockets.get(data.to);
        if (recipId) io.to(recipId).emit('typing', { from: data.from });
    });

    socket.on('update ringtone settings', (data) => {
        const { username, settings } = data;
        if (username && settings) {
            saveUserSettings(username, settings);
            socket.emit('ringtone settings updated', { success: true });
        }
    });

    socket.on('disconnect', (reason) => {
        const userInfo = connectedUsers.get(socket.id);
        if (!userInfo) return;
        const { username } = userInfo;
        console.log(`⚠️ Disconnected: ${username} (${reason})`);
        for (const [callId, callInfo] of activeCalls.entries()) {
            if (callInfo.from === username || callInfo.to === username) {
                const other = callInfo.from === username ? callInfo.to : callInfo.from;
                const otherId = userSockets.get(other);
                if (otherId) {
                    io.to(otherId).emit('stop-ringtone', { callId, reason: 'disconnected' });
                    io.to(otherId).emit('video-call-end', { from: username, callId, reason: 'disconnected' });
                }
                activeCalls.delete(callId);
            }
        }
        for (const [roomId, room] of groupCallRooms.entries()) {
            if (room.members.has(username)) {
                room.members.delete(username);
                io.to(`group-${roomId}`).emit('group-call-member-left', { roomId, username });
                if (room.members.size === 0) groupCallRooms.delete(roomId);
            }
        }
        const cd = readContacts();
        const contact = cd.contacts.find(c => c.name === username);
        if (contact) { contact.status = 'offline'; writeJSON(contactsFilePath, cd); }
        if (userSockets.get(username) === socket.id) {
            userSockets.delete(username);
            io.emit('user status change', { username, status: 'offline' });
        }
        connectedUsers.delete(socket.id);
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
        socket.emit('force-reload', { reason: 'socket_error' });
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/chat.html', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 ${signal} received – shutting down...`);
    io.close(() => {
        server.close(() => {
            try { if (fs.existsSync(uploadsDir)) fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch(e) { }
            console.log('🛑 Server closed cleanly');
            process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (e) => { console.error('Uncaught:', e); gracefulShutdown('uncaughtException'); });
process.on('unhandledRejection', (r) => { console.error('Unhandled:', r); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`☁️  Cloudinary ready`);
    console.log(`🔐 Admin password: admin123`);
    console.log(`========================================\n`);
});
