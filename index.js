const { Telegraf, Markup } = require('telegraf');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- Configuration ---
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE'; // Thay bằng token từ BotFather
const ADMIN_ID = YOUR_ADMIN_ID_HERE; // Thay bằng ID Telegram của admin
const API_URL = 'https://sunai.onrender.com/api/taixiu/sunwin'; // Đảm bảo API hoạt động
const API_INTERVAL = 3000; // 3 giây

// --- Proxy Configuration (Optional) ---
// Để trống hoặc đặt null nếu không dùng proxy
const PROXY_URL = null; // Ví dụ: 'http://user:pass@proxy_ip:port' nếu dùng proxy

// --- Initialize Bot ---
let bot;
if (PROXY_URL && PROXY_URL.startsWith('http')) {
    bot = new Telegraf(BOT_TOKEN, { telegram: { agent: new HttpsProxyAgent(PROXY_URL) } });
    console.log(`Bot started with HTTP Proxy: ${PROXY_URL}`);
} else {
    bot = new Telegraf(BOT_TOKEN);
    console.log('Bot started without Proxy.');
}

// --- File Paths ---
const KEYS_FILE = 'keys.json';
const USERS_FILE = 'users.json';
const PREDICTION_HISTORY_FILE = 'prediction_history.json';

// --- In-Memory Data ---
let keys = {};
let users = { [ADMIN_ID]: { active: true, keyUsed: 'admin', isAdmin: true } };
let predictionHistory = [];
let currentApiData = null;
let lastDisplayedSession = null;
let apiIntervalId;
let isBotRunning = false;

// --- File Operations ---
function loadData(filePath, defaultData) {
    if (existsSync(filePath)) {
        try {
            return JSON.parse(readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error(`Error reading ${filePath}:`, e);
            return defaultData;
        }
    }
    return defaultData;
}

function saveData(filePath, data) {
    try {
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Error writing ${filePath}:`, e);
    }
}

// --- Load Initial Data ---
keys = loadData(KEYS_FILE, {});
users = loadData(USERS_FILE, users);
predictionHistory = loadData(PREDICTION_HISTORY_FILE, []);

// --- Helper Functions ---
const isAdmin = (userId) => users[userId] && users[userId].isAdmin;
const isMainAdmin = (userId) => userId === ADMIN_ID;

function isValidKey(key) {
    const keyData = keys[key];
    if (!keyData) return false;
    if (keyData.uses >= keyData.maxUses) return false;
    if (keyData.expiresAt && Date.now() > keyData.expiresAt) return false;
    return true;
}

function useKey(key) {
    if (keys[key]) {
        keys[key].uses++;
        saveData(KEYS_FILE, keys);
    }
}

function sendBroadcastMessage(message) {
    for (const userId in users) {
        if (users[userId]?.active) {
            bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' }).catch(e => {
                console.error(`Failed to send to ${userId}:`, e.message);
                if (e.message.includes('bot was blocked')) {
                    users[userId].active = false;
                    saveData(USERS_FILE, users);
                }
            });
        }
    }
}

function formatPredictionData(data) {
    if (!data) return "Không có dữ liệu dự đoán.";
    const { Phien, Ket_qua, Xuc_xac_1, Xuc_xac_2, Xuc_xac_3, Phien_hien_tai, du_doan, Pattern } = data;
    const DICE = `${Xuc_xac_1 || 0} - ${Xuc_xac_2 || 0} - ${Xuc_xac_3 || 0}`;
    return `
🎰 *TOOL SUNWIN V1 😘😘*
═════════════════════════════
*PHIÊN TRƯỚC*: ${Phien || 'N/A'}
*KẾT QUẢ*: ${Ket_qua || 'N/A'}
*DICE*: ${DICE}
═════════════════════════════ 
*PHIÊN HIỆN TẠI*: ${Phien_hien_tai || 'N/A'}
*DỰ ĐOÁN*: ${du_doan || 'N/A'}
*CẦU*: ${Pattern || 'N/A'}
═════════════════════════════ 
`.trim();
}

async function fetchAndProcessApiData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();

        if (data.Phien_hien_tai && data.Phien_hien_tai !== lastDisplayedSession) {
            currentApiData = data;
            lastDisplayedSession = data.Phien_hien_tai;

            predictionHistory.push({
                timestamp: new Date().toISOString(),
                session: data.Phien_hien_tai,
                data
            });
            saveData(PREDICTION_HISTORY_FILE, predictionHistory);

            const message = formatPredictionData(data);
            for (const userId in users) {
                if (users[userId]?.active && users[userId].keyUsed) {
                    bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' }).catch(e => {
                        console.error(`Failed to send to ${userId}:`, e.message);
                        if (e.message.includes('bot was blocked')) {
                            users[userId].active = false;
                            saveData(USERS_FILE, users);
                        }
                    });
                }
            }
        } else {
            currentApiData = data;
        }
    } catch (error) {
        console.error('API fetch error:', error.message);
        bot.telegram.sendMessage(ADMIN_ID, `Lỗi API: ${error.message}`).catch(console.error);
    }
}

// --- Commands ---
bot.start((ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name;

    if (!users[userId]) {
        users[userId] = { active: true, keyUsed: null, isAdmin: false };
        saveData(USERS_FILE, users);
    } else {
        users[userId].active = true;
    }

    const message = isAdmin(userId)
        ? `Xin chào Admin ${userName}! 👋\n\n*Admin Commands:*\n/getkey <key> <uses> <duration> <unit>\n/xoakey <key>\n/addadmin <id>\n/xoaadmin <id>\n/check\n/thongbao <message>\n\n*Common Commands:*\n/chaybot\n/tatbot\n/key <key>`
        : users[userId].keyUsed
        ? `Chào ${userName}! Bot đã kích hoạt.\n\n/chaybot\n/tatbot`
        : `Chào ${userName}! Dùng /key <key> để kích hoạt.`;
    ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('key', (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ').slice(1);
    const userKey = args[0];

    if (!userKey) return ctx.reply('Nhập /key <key_của_bạn>');
    if (users[userId]?.keyUsed) return ctx.reply('Bot đã kích hoạt.');
    if (isValidKey(userKey)) {
        useKey(userKey);
        users[userId].keyUsed = userKey;
        users[userId].active = true;
        saveData(USERS_FILE, users);
        ctx.reply('Key kích hoạt thành công! Dùng /chaybot.');
    } else {
        ctx.reply('Key không hợp lệ. Liên hệ admin.');
    }
});

bot.command('chaybot', async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId) && (!users[userId] || !users[userId].keyUsed)) return ctx.reply('Kích hoạt bằng /key <key> trước.');
    if (isBotRunning) return ctx.reply('Bot đã chạy.');

    isBotRunning = true;
    users[userId].active = true;
    saveData(USERS_FILE, users);

    if (currentApiData) {
        await ctx.reply('Bot khởi động...');
        ctx.reply(formatPredictionData(currentApiData), { parse_mode: 'Markdown' });
    } else {
        ctx.reply('Bot khởi động... Đang chờ dữ liệu API.', { parse_mode: 'Markdown' });
    }

    if (!apiIntervalId) {
        apiIntervalId = setInterval(fetchAndProcessApiData, API_INTERVAL);
        console.log('API fetching started.');
    }
});

bot.command('tatbot', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId) && (!users[userId] || !users[userId].keyUsed)) return ctx.reply('Bạn chưa kích hoạt bot.');

    users[userId].active = false;
    saveData(USERS_FILE, users);

    const activeUsers = Object.values(users).filter(u => u.active && u.keyUsed).length;
    if (activeUsers === 0 || (isMainAdmin(userId) && activeUsers === 0)) {
        clearInterval(apiIntervalId);
        apiIntervalId = null;
        isBotRunning = false;
        console.log('API fetching stopped.');
    }

    ctx.reply('Bot đã dừng.');
});

// --- Admin Commands ---
bot.command('getkey', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return ctx.reply('Không có quyền.');
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length !== 4) return ctx.reply('/getkey <key> <uses> <duration> <unit (h/d)>');

    const [keyName, usesLimitStr, durationValueStr, durationUnit] = args;
    const usesLimit = parseInt(usesLimitStr);
    const durationValue = parseInt(durationValueStr);

    if (isNaN(usesLimit) || usesLimit <= 0 || isNaN(durationValue) || durationValue <= 0 || !['h', 'd'].includes(durationUnit)) {
        return ctx.reply('Sai cú pháp. Ví dụ: /getkey abc 10 2 d');
    }

    if (keys[keyName]) return ctx.reply(`Key ${keyName} đã tồn tại.`);

    const expiresAt = durationUnit === 'h' ? Date.now() + durationValue * 60 * 60 * 1000 : Date.now() + durationValue * 24 * 60 * 60 * 1000;
    keys[keyName] = { uses: 0, maxUses: usesLimit, expiresAt, creatorId: userId, createdAt: new Date().toISOString() };
    saveData(KEYS_FILE, keys);
    ctx.reply(`Key ${keyName} tạo thành công. Sử dụng: ${usesLimit} lần. Hết hạn: ${new Date(expiresAt).toLocaleString()}`);
});

bot.command('xoakey', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return ctx.reply('Không có quyền.');
    const args = ctx.message.text.split(' ').slice(1);
    const keyName = args[0];

    if (!keyName) return ctx.reply('/xoakey <key>');
    if (keys[keyName]) {
        delete keys[keyName];
        for (const uid in users) if (users[uid].keyUsed === keyName) users[uid].keyUsed = null;
        saveData(KEYS_FILE, keys);
        saveData(USERS_FILE, users);
        ctx.reply(`Key ${keyName} đã xóa.`);
    } else {
        ctx.reply(`Key ${keyName} không tồn tại.`);
    }
});

bot.command('addadmin', (ctx) => {
    const userId = ctx.from.id;
    if (!isMainAdmin(userId)) return ctx.reply('Chỉ admin chính.');
    const args = ctx.message.text.split(' ').slice(1);
    const targetId = parseInt(args[0]);

    if (isNaN(targetId) || targetId === ADMIN_ID) return ctx.reply('ID không hợp lệ.');
    if (!users[targetId]) users[targetId] = { active: false, keyUsed: null, isAdmin: false };
    if (users[targetId].isAdmin) return ctx.reply(`${targetId} đã là admin.`);

    users[targetId].isAdmin = true;
    users[targetId].active = true;
    saveData(USERS_FILE, users);
    ctx.reply(`${targetId} đã là admin phụ.`);
    bot.telegram.sendMessage(targetId, 'Bạn là admin phụ.', { parse_mode: 'Markdown' }).catch(console.error);
});

bot.command('xoaadmin', (ctx) => {
    const userId = ctx.from.id;
    if (!isMainAdmin(userId)) return ctx.reply('Chỉ admin chính.');
    const args = ctx.message.text.split(' ').slice(1);
    const targetId = parseInt(args[0]);

    if (isNaN(targetId) || targetId === ADMIN_ID) return ctx.reply('ID không hợp lệ.');
    if (!users[targetId] || !users[targetId].isAdmin) return ctx.reply(`${targetId} không phải admin.`);

    users[targetId].isAdmin = false;
    saveData(USERS_FILE, users);
    ctx.reply(`${targetId} đã bị xóa khỏi admin.`);
    bot.telegram.sendMessage(targetId, 'Bạn không còn là admin phụ.', { parse_mode: 'Markdown' }).catch(console.error);
});

bot.command('check', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return ctx.reply('Không có quyền.');
    let msg = '--- Người dùng ---\n';
    let userCount = 0;
    for (const id in users) {
        userCount++;
        const { active, isAdmin, keyUsed } = users[id];
        msg += `ID: ${id} | ${isAdmin ? 'Admin' : 'User'} | ${active ? 'Active' : 'Inactive'} ${keyUsed ? `| Key: ${keyUsed}` : ''}\n`;
    }
    msg += `\nTổng: ${userCount}\n\n--- Key ---\n`;
    let keyCount = 0;
    for (const key in keys) {
        keyCount++;
        const { uses, maxUses, expiresAt } = keys[key];
        msg += `Key: ${key} | ${uses}/${maxUses} | ${expiresAt ? new Date(expiresAt).toLocaleString() : 'Không hạn'}\n`;
    }
    msg += `Tổng: ${keyCount}`;
    ctx.reply(msg);
});

bot.command('thongbao', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return ctx.reply('Không có quyền.');
    const message = ctx.message.text.slice('/thongbao '.length).trim();
    if (!message) return ctx.reply('/thongbao <nội dung>');
    sendBroadcastMessage(`📣 THÔNG BÁO: ${message}`);
    ctx.reply('Đã gửi thông báo.');
});

bot.on('text', (ctx) => {
    if (!ctx.message.text.startsWith('/')) {
        const userId = ctx.from.id;
        ctx.reply(isAdmin(userId) ? 'Dùng /help để xem lệnh.' : users[userId]?.keyUsed ? '/chaybot hoặc /tatbot' : '/key <key> để kích hoạt.');
    }
});

// --- Launch Bot ---
bot.launch().then(() => {
    console.log('Bot Sunwin started!');
    apiIntervalId = setInterval(fetchAndProcessApiData, API_INTERVAL);
    for (const userId in users) {
        if (users[userId].active && users[userId].keyUsed && userId !== ADMIN_ID) {
            bot.telegram.sendMessage(userId, 'Bot Sunwin đã khởi động!').catch(console.error);
        }
    }
}).catch(err => console.error('Bot launch error:', err));

process.once('SIGINT', () => { clearInterval(apiIntervalId); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { clearInterval(apiIntervalId); bot.stop('SIGTERM'); });
