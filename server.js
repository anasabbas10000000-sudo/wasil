const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// ==================== Cloudinary Config ====================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dezprpy5q',
    api_key: process.env.CLOUDINARY_API_KEY || '462762935819578',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'vV6GrKIp-VBifpafhdz4Bs82xdA'
});

// ==================== Server Setup ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
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

// ==================== Uploads Folder ====================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ==================== WebRTC Config with RELIABLE TURN Servers ====================
// ✅ FIX: Added production-ready TURN servers for cross-network connectivity
const webrtcConfig = {
    iceServers: [
        // STUN servers for NAT traversal
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.stunprotocol.org:3478' },
        
        // ✅ CRITICAL: TURN servers for when STUN fails (different networks)
        // Using free TURN servers from Metered.ca (reliable for production)
        {
            urls: [
                'turn:openrelay.metered.ca:80',
                'turn:openrelay.metered.ca:443',
                'turn:openrelay.metered.ca:443?transport=tcp'
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        // ✅ Backup TURN servers
        {
            urls: [
                'turn:relay.metered.ca:80',
                'turn:relay.metered.ca:443',
                'turn:relay.metered.ca:443?transport=tcp'
            ],
            username: 'e8dd65b0c40c46a4add14cbb',
            credential: 'uMmzxOLwJjHGsGVm'
        }
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceTransportPolicy: 'all',
    sdpSemantics: 'unified-plan'
};

// ✅ Send WebRTC config to client
app.get('/webrtc-config', (req, res) => {
    res.json(webrtcConfig);
});

// ==================== Multer ====================
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

// ==================== Cloudinary Upload ====================
async function uploadToCloudinary(buffer, originalName, mimetype) {
    return new Promise((resolve, reject) => {
        let resourceType = 'auto';
        if (mimetype.startsWith('image/'))  resourceType = 'image';
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

// ==================== File Upload Handler ====================
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
app.post('/api/upload',  upload.single('file'), handleFileUpload);
app.post('/upload',      upload.single('file'), handleFileUpload);
app.use('/uploads', express.static(uploadsDir));

// ==================== Data File Paths ====================
const codesFilePath       = path.join(__dirname, 'access_codes.json');
const contactsFilePath    = path.join(__dirname, 'contacts.json');
const privateMessagesPath = path.join(__dirname, 'private_messages.json');
const settingsFilePath    = path.join(__dirname, 'user_settings.json');
const sessionFilePath     = path.join(__dirname, 'user_sessions.json');
const oauthUsersPath      = path.join(__dirname, 'oauth_users.json');

// ==================== File Helpers ====================
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
            { id:'1', name:'أحمد محمد',  phone:'0501111111', avatar:'أ', status:'online' },
            { id:'2', name:'سارة أحمد',  phone:'0502222222', avatar:'س', status:'offline' },
            { id:'3', name:'محمد علي',   phone:'0503333333', avatar:'م', status:'online' },
            { id:'4', name:'فاطمة حسن',  phone:'0504444444', avatar:'ف', status:'offline' },
            { id:'5', name:'عبدالله عمر',phone:'0505555555', avatar:'ع', status:'online' }
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

// ==================== OAuth Users ====================
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
    } else {
        existing.lastLogin = new Date().toISOString();
    }
    writeJSON(oauthUsersPath, data);
    return data.users.find(u => u.id === profile.id && u.provider === profile.provider);
}

// ==================== API Routes ====================
app.post('/verify-code', (req, res) => {
    const codes = readJSON(codesFilePath, { codes:['1234','5678'] });
    res.json(codes.codes.includes(req.body.code)
        ? { success:true }
        : { success:false, message:'رمز غير صحيح' });
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
    const c = { id:Date.now().toString(), name:req.body.name, phone:req.body.phone, avatar:req.body.name.charAt(0), status:'offline' };
    d.contacts.push(c);
    writeJSON(contactsFilePath, d);
    res.json({ success:true, contact:c });
});

app.post('/delete-contact', (req, res) => {
    const d = readContacts();
    const i = d.contacts.findIndex(c => c.id === req.body.contactId);
    if (i !== -1) { d.contacts.splice(i,1); writeJSON(contactsFilePath, d); res.json({ success:true }); }
    else res.json({ success:false });
});

app.post('/get-conversation', (req, res) => {
    const d = readPrivateMessages();
    const key = getConversationId(req.body.userId, req.body.contactId);
    res.json({ messages: d.conversations[key] || [] });
});

app.post('/cleanup-messages', (req, res) => {
    const { username, days } = req.body;
    if (!days || days <= 0) return res.json({ success:true, cleanedCount:0 });
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const d = readPrivateMessages(); let count = 0;
    for (const key of Object.keys(d.conversations)) {
        const orig = d.conversations[key].length;
        d.conversations[key] = d.conversations[key].filter(m => new Date(m.timestamp) > cutoff);
        count += orig - d.conversations[key].length;
    }
    writeJSON(privateMessagesPath, d);
    res.json({ success:true, cleanedCount:count });
});

app.post('/update-status', (req, res) => {
    const d = readContacts();
    const c = d.contacts.find(c => c.id === req.body.userId || c.name === req.body.userId);
    if (c) { c.status = req.body.status; writeJSON(contactsFilePath, d); res.json({ success:true }); }
    else res.json({ success:false });
});

app.get('/get-ringtone-settings', (req, res) => {
    if (!req.query.username) return res.status(400).json({ success:false });
    res.json({ success:true, settings: readUserSettings(req.query.username) });
});

app.post('/update-ringtone-settings', (req, res) => {
    const { username, settings } = req.body;
    if (!username || !settings) return res.status(400).json({ success:false });
    res.json({ success: saveUserSettings(username, settings) });
});

app.post('/save-user-state', (req, res) => {
    const { username, state } = req.body;
    res.json({ success: username && state ? saveUserSession(username, state) : false });
});

app.get('/get-user-state', (req, res) => {
    res.json({ success:true, state: getUserSession(req.query.username) });
});

app.post('/delete-message', (req, res) => {
    const { userId, contactId, messageId } = req.body;
    const d = readPrivateMessages();
    const key = getConversationId(userId, contactId);
    if (d.conversations[key]) {
        d.conversations[key] = d.conversations[key].filter(m => m.id !== messageId);
        writeJSON(privateMessagesPath, d);
    }
    res.json({ success:true });
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
    res.json({ success:true, ringtones });
});

// ==================== In-Memory State ====================
const connectedUsers = new Map();
const userSockets    = new Map();
const activeCalls    = new Map();
const groupCallRooms = new Map();

// ==================== Socket.IO ====================
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
                    oldSock.emit('force-reload', { reason:'new_connection' });
                    setTimeout(() => oldSock.disconnect(true), 600);
                }
            }
        }

        userSockets.set(username, socket.id);

        const cd = readContacts();
        const contact = cd.contacts.find(c => c.name === username);
        if (contact) { contact.status = 'online'; writeJSON(contactsFilePath, cd); }

        socket.broadcast.emit('user status change', { username, status:'online' });
        socket.emit('contacts list', { contacts: readContacts().contacts });
        socket.emit('ringtone settings', { settings: readUserSettings(username) });
        socket.emit('registration-confirmed', { username, timestamp: Date.now() });
        console.log(`✅ Registered: ${username}`);
    });

    // Video Call Events
    socket.on('video-call-init', (data) => {
        const { to, quality = 'high', videoEnabled = true, audioEnabled = true, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);

        if (!fromUser) return;

        if (!targetId) {
            return socket.emit('video-call-error', { message:'المستخدم غير متصل', code:'user_offline' });
        }

        const finalCallId = callId || `${fromUser.username}_${to}_${Date.now()}`;
        const targetSettings = readUserSettings(to);

        activeCalls.set(finalCallId, {
            from: fromUser.username, to,
            quality, startTime: Date.now(),
            videoEnabled, audioEnabled,
            pendingCandidates: []
        });

        console.log(`📹 Call init: ${fromUser.username} → ${to} [${finalCallId}]`);

        socket.emit('outgoing-call', { to, callId: finalCallId, message:`جاري الاتصال بـ ${to}...` });

        io.to(targetId).emit('video-call-init', {
            from: fromUser.username,
            quality, videoEnabled, audioEnabled,
            callId: finalCallId,
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

        io.to(targetId).emit('stop-ringtone', { callId, reason:'answered' });
        socket.emit('stop-ringtone', { callId, reason:'answered' });

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

    socket.on('video-call-ice-complete', (data) => {
        const { to, callId } = data;
        const fromUser = connectedUsers.get(socket.id);
        const targetId = userSockets.get(to);
        if (!fromUser || !targetId) return;
        io.to(targetId).emit('video-call-ice-complete', { from: fromUser.username, callId });
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
            io.to(targetId).emit('stop-ringtone', { callId, reason:'rejected' });
            io.to(targetId).emit('video-call-reject', { from: fromUser.username, callId });
        }
        socket.emit('stop-ringtone', { callId, reason:'rejected' });

        if (callId && activeCalls.has(callId)) activeCalls.delete(callId);
    });

    // Group Call Events
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

    // Message Events
    socket.on('private message', (data) => {
        const { from, to, message, timestamp, messageId } = data;
        const d = readPrivateMessages();
        const key = getConversationId(from, to);
        if (!d.conversations[key]) d.conversations[key] = [];
        d.conversations[key].push({
            id: messageId || Date.now().toString(),
            from, to, message, type:'text',
            timestamp: timestamp || new Date().toISOString(),
            read: false
        });
        writeJSON(privateMessagesPath, d);

        const recipId = userSockets.get(to);
        if (recipId) io.to(recipId).emit('private message', { from, message, timestamp, messageId });
        socket.emit('message sent', { messageId, status:'sent' });
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
            from, to, type:'voice', audioUrl, duration,
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
            socket.emit('ringtone settings updated', { success:true });
        }
    });

    // Disconnect
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
                    io.to(otherId).emit('stop-ringtone', { callId, reason:'disconnected' });
                    io.to(otherId).emit('video-call-end', { from: username, callId, reason:'disconnected' });
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
            io.emit('user status change', { username, status:'offline' });
        }

        connectedUsers.delete(socket.id);
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
        socket.emit('force-reload', { reason:'socket_error' });
    });
});

// ==================== Routes ====================
app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html',(req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/chat.html', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

// ==================== Graceful Shutdown ====================
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 ${signal} received – shutting down...`);
    io.close(() => {
        server.close(() => {
            try { if (fs.existsSync(uploadsDir)) fs.rmSync(uploadsDir, { recursive:true, force:true }); } catch(e){}
            console.log('🛑 Server closed cleanly');
            process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException',  (e) => { console.error('Uncaught:', e); gracefulShutdown('uncaughtException'); });
process.on('unhandledRejection', (r) => { console.error('Unhandled:', r); });

// ==================== Start ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`☁️  Cloudinary ready`);
    console.log(`\n📹 Video call features:`);
    console.log(`   ✅ Cross-network calls (TURN servers enabled)`);
    console.log(`   ✅ iPhone ↔ Computer`);
    console.log(`   ✅ iPhone ↔ iPhone`);
    console.log(`   ✅ MacBook ↔ iPhone`);
    console.log(`   ✅ Computer ↔ MacBook`);
    console.log(`   ✅ Group calls (mesh)`);
    console.log(`   ✅ ICE candidate buffering`);
    console.log(`   ✅ Camera flip (mobile)`);
    console.log(`   ✅ Speaker toggle`);
    console.log(`   ✅ ICE restart on failure`);
    console.log(`========================================\n`);
});
