const { Telegraf, Markup } = require('telegraf');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const fetch = require('node-fetch');

// Cài đặt một trong hai thư viện proxy này, tùy thuộc vào loại proxy bạn có
const { HttpsProxyAgent } = require('https-proxy-agent'); // Dành cho HTTP/HTTPS proxy
const { SocksProxyAgent } = require('socks-proxy-agent'); // Dành cho SOCKS proxy (thường là SOCKS5)

// --- Cấu hình Bot ---
const BOT_TOKEN = '7804059790:AAEFHgjLvJrBfSYUA3WPCEqspJUhVHBafXM'; // Token bot của bạn
const ADMIN_ID = 6781092017; // ID của admin chính
const API_URL = 'https://sunai.onrender.com/api/taixiu/sunwin'; // API URL của bạn
const API_INTERVAL = 3000; // Tần suất gọi API (3 giây)

// --- Cấu hình Proxy (CHỌN MỘT VÀ ĐIỀN THÔNG TIN CỦA BẠN VÀO ĐÂY) ---
// Thay thế 'your_proxy_ip', 'your_proxy_port', 'user', 'password' bằng thông tin thật của bạn.

// Nếu bạn dùng HTTP/HTTPS Proxy (thường dùng cho các dịch vụ proxy web):
// const PROXY_URL = 'http://your_proxy_ip:your_proxy_port';
// Nếu proxy có xác thực: const PROXY_URL = 'http://user:password@your_proxy_ip:your_proxy_port';

// Hoặc nếu bạn dùng SOCKS5 Proxy (thường là proxy cá nhân để vượt tường lửa):
// const PROXY_URL = 'socks5://your_proxy_ip:your_proxy_port';
// Nếu proxy có xác thực: const PROXY_URL = 'socks5h://user:password@your_proxy_ip:your_proxy_port';

// KHÔNG DÙNG PROXY: Để trống PROXY_URL nếu bạn không muốn sử dụng proxy.
const PROXY_URL = ''; // Để trống nếu không dùng proxy

// --- Khởi tạo Bot với cấu hình Proxy ---
let bot;
if (PROXY_URL) {
    if (PROXY_URL.startsWith('http')) {
        bot = new Telegraf(BOT_TOKEN, {
            telegram: {
                agent: new HttpsProxyAgent(PROXY_URL)
            }
        });
        console.log(`Bot khởi động với HTTP Proxy: ${PROXY_URL}`);
    } else if (PROXY_URL.startsWith('socks')) {
        bot = new Telegraf(BOT_TOKEN, {
            telegram: {
                agent: new SocksProxyAgent(PROXY_URL)
            }
        });
        console.log(`Bot khởi động với SOCKS Proxy: ${PROXY_URL}`);
    } else {
        console.warn('Cấu hình PROXY_URL không hợp lệ. Khởi động bot không dùng Proxy.');
        bot = new Telegraf(BOT_TOKEN);
    }
} else {
    // Không dùng proxy nếu PROXY_URL rỗng
    bot = new Telegraf(BOT_TOKEN);
    console.log('Bot khởi động không dùng Proxy.');
}

// --- Tên file lưu trữ dữ liệu ---
const KEYS_FILE = 'keys.json';
const USERS_FILE = 'users.json';
const PREDICTION_HISTORY_FILE = 'prediction_history.json';

// --- Biến lưu trữ dữ liệu trong bộ nhớ ---
let keys = {}; // { "key_code": { uses: int, maxUses: int, expiresAt: timestamp, creatorId: int } }
let users = {}; // { "user_id": { active: boolean, keyUsed: string, isAdmin: boolean } }
let predictionHistory = []; // Lịch sử các dự đoán API đã hiển thị
let currentApiData = null; // Dữ liệu API mới nhất
let lastDisplayedSession = null; // Phiên gần nhất đã hiển thị trên bot

// --- Hàm đọc/ghi file ---
function loadData(filePath, defaultData) {
    if (existsSync(filePath)) {
        try {
            return JSON.parse(readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error(`Lỗi đọc file ${filePath}:`, e);
            return defaultData;
        }
    }
    return defaultData;
}

function saveData(filePath, data) {
    try {
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Lỗi ghi file ${filePath}:`, e);
    }
}

// --- Tải dữ liệu khi khởi động ---
keys = loadData(KEYS_FILE, {});
users = loadData(USERS_FILE, { [ADMIN_ID]: { active: true, keyUsed: 'admin', isAdmin: true } }); // Đặt admin mặc định
predictionHistory = loadData(PREDICTION_HISTORY_FILE, []);

// --- Hàm kiểm tra quyền ---
const isAdmin = (userId) => users[userId] && users[userId].isAdmin;
const isMainAdmin = (userId) => userId === ADMIN_ID;

// --- Hàm kiểm tra key ---
function isValidKey(key) {
    const keyData = keys[key];
    if (!keyData) return false;
    if (keyData.uses >= keyData.maxUses) return false;
    if (keyData.expiresAt && Date.now() > keyData.expiresAt) return false;
    return true;
}

// --- Hàm cập nhật key đã sử dụng ---
function useKey(key) {
    if (keys[key]) {
        keys[key].uses++;
        saveData(KEYS_FILE, keys);
    }
}

// --- Hàm gửi thông báo chung ---
function sendBroadcastMessage(message) {
    for (const userId in users) {
        // Chỉ gửi cho người dùng active và không phải admin chính (admin chính có thể nhận thông báo riêng)
        if (users[userId].active && userId != ADMIN_ID) {
            bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' }).catch(e => {
                console.error(`Không thể gửi tin nhắn tới người dùng ${userId}:`, e.message);
                // Đánh dấu user là inactive nếu lỗi do block bot
                if (e.message.includes('bot was blocked by the user')) {
                    users[userId].active = false;
                    saveData(USERS_FILE, users);
                }
            });
        }
    }
}

// --- Hàm định dạng dữ liệu API để hiển thị ---
function formatPredictionData(data) {
    if (!data) return "Không có dữ liệu dự đoán.";

    const PHIEN = data.Phien;
    const KET_QUA = data.Ket_qua;
    const DICE = `${data.Xuc_xac_1} - ${data.Xuc_xac_2} - ${data.Xuc_xac_3}`;
    const PHIEN_HIEN_TAI = data.Phien_hien_tai;
    const DU_DOAN = data.du_doan;
    const CAU = data.Pattern;

    return `
🎰 *TOOL SUNWIN V1 😘😘*
═════════════════════════════
*PHIÊN TRƯỚC*: ${PHIEN || 'N/A'}
*KẾT QUẢ*: ${KET_QUA || 'N/A'}
*XÚC XẮC*: ${DICE || 'N/A'}
═════════════════════════════ 
*PHIÊN HIỆN TẠI*: ${PHIEN_HIEN_TAI || 'N/A'}
*DỰ ĐOÁN*: ${DU_DOAN || 'N/A'}
*CẦU*: ${CAU || 'N/A'}
═════════════════════════════ 
`.trim();
}

// --- Scheduler gọi API và cập nhật trạng thái ---
let apiIntervalId;
let isBotRunningGlobally = false; // Trạng thái bot chạy (lấy dữ liệu API)

async function fetchAndProcessApiData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) {
            throw new Error(`Lỗi HTTP! Status: ${response.status}`);
        }
        const data = await response.json();

        // Kiểm tra nếu có phiên mới (sử dụng Phien_hien_tai từ API mới)
        if (data.Phien_hien_tai && data.Phien_hien_tai !== lastDisplayedSession) {
            console.log(`Phát hiện phiên mới: ${data.Phien_hien_tai}`);
            // Cập nhật dữ liệu mới nhất
            currentApiData = data;
            lastDisplayedSession = data.Phien_hien_tai;

            // Ghi vào lịch sử dự đoán
            predictionHistory.push({
                timestamp: new Date().toISOString(),
                session: data.Phien_hien_tai,
                data: data
            });
            // Giới hạn lịch sử để tránh file quá lớn, ví dụ: 100 phiên gần nhất
            if (predictionHistory.length > 100) {
                predictionHistory = predictionHistory.slice(predictionHistory.length - 100);
            }
            saveData(PREDICTION_HISTORY_FILE, predictionHistory);

            // Gửi dữ liệu mới tới tất cả người dùng active
            const formattedMessage = formatPredictionData(data);
            for (const userId in users) {
                if (users[userId].active && users[userId].keyUsed) { // Chỉ gửi cho user đã kích hoạt và active
                    bot.telegram.sendMessage(userId, formattedMessage, { parse_mode: 'Markdown' }).catch(e => {
                        console.error(`Không thể gửi dự đoán tới người dùng ${userId}:`, e.message);
                        if (e.message.includes('bot was blocked by the user')) {
                            users[userId].active = false;
                            saveData(USERS_FILE, users);
                        }
                    });
                }
            }
        } else {
            // Cập nhật dữ liệu mới nhất ngay cả khi không có phiên mới để dùng cho /chaybot nếu cần
            currentApiData = data;
            // console.log('Không có phiên mới, giữ nguyên hiển thị hiện tại.');
        }

    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu API:', error.message);
        // Có thể gửi thông báo lỗi tới admin nếu muốn
        // bot.telegram.sendMessage(ADMIN_ID, `Lỗi API: ${error.message}`).catch(e => console.error("Không thể gửi lỗi API tới admin:", e.message));
    }
}

// --- Lệnh /start ---
bot.start((ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name || 'bạn';

    // Ghi nhận người dùng mới
    if (!users[userId]) {
        users[userId] = { active: true, keyUsed: null, isAdmin: false };
        saveData(USERS_FILE, users);
        console.log(`Người dùng mới đã bắt đầu bot: ${userId} (${userName})`);
    } else {
        users[userId].active = true; // Đảm bảo active nếu họ đã dừng trước đó
        saveData(USERS_FILE, users);
    }

    if (isAdmin(userId)) {
        ctx.reply(
            `Xin chào Admin ${userName}! 👋 Bạn có thể dùng các lệnh quản lý bot.` +
            '\n\n*Các lệnh cho Admin:*\n' +
            '/getkey `<tên_key>` `<số_lượt_dùng>` `<giá_trị_thời_gian>` `<đơn_vị (h/d)>` - Tạo key mới\n' +
            '  _Ví dụ: `/getkey abcxyz 10 2 d` (key abcxyz dùng 10 lần trong 2 ngày)_\n' +
            '/xoakey `<tên_key>` - Xóa key đã tạo\n' +
            '/addadmin `<ID_người_dùng>` - Thêm admin phụ (chỉ admin chính dùng)\n' +
            '/xoaadmin `<ID_người_dùng>` - Xóa admin phụ (chỉ admin chính dùng)\n' +
            '/check - Xem danh sách người dùng và key\n' +
            '/thongbao `<tin_nhắn_của_bạn>` - Gửi thông báo tới tất cả người dùng\n\n' +
            '*Các lệnh chung:*\n' +
            '/chaybot - Khởi động bot và nhận dự đoán\n' +
            '/tatbot - Dừng bot và không nhận dự đoán\n' +
            '/key `<key_của_bạn>` - Kích hoạt bot bằng key'
        );
    } else if (users[userId].keyUsed) {
        ctx.reply(
            `Chào mừng bạn trở lại, ${userName}! Bot của bạn đã được kích hoạt.` +
            '\n\n*Các lệnh của bạn:*\n' +
            '/chaybot - Khởi động bot và nhận dự đoán\n' +
            '/tatbot - Dừng bot và không nhận dự đoán'
        );
    } else {
        ctx.reply(
            `Chào mừng bạn, ${userName}! Để sử dụng bot, bạn cần có key kích hoạt.` +
            '\n\nVui lòng nhập lệnh `/key <key_của_bạn>` để kích hoạt bot.' +
            '\n\n*Thông tin về Bot:*\n' +
            'Tool Sunwin V1😘😘\n' +
            'Không đảm bảo 100% chính xác.\n' +
            'Tool By Tuấn Tú\n' +
            'Bot liên kết với API:\n' +
            'https://sunai.onrender.com/api/taixiu/sunwin'
        );
    }
});

// --- Lệnh /key ---
bot.command('key', (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ').slice(1);
    const userKey = args[0];

    if (!userKey) {
        return ctx.reply('Vui lòng nhập key của bạn sau lệnh /key. Ví dụ: `/key ABCXYZ`');
    }

    if (users[userId] && users[userId].keyUsed) {
        return ctx.reply('Bạn đã kích hoạt bot rồi.');
    }

    if (isValidKey(userKey)) {
        useKey(userKey);
        users[userId].keyUsed = userKey;
        users[userId].active = true; // Kích hoạt người dùng
        saveData(USERS_FILE, users);
        ctx.reply('Key của bạn đã được kích hoạt thành công! 🎉' +
            '\n\nBây giờ bạn có thể dùng lệnh `/chaybot` để bắt đầu nhận dự đoán.');
    } else {
        ctx.reply('Key không hợp lệ hoặc đã hết hạn/số lượt sử dụng. Vui lòng liên hệ admin.');
    }
});

// --- Lệnh /chaybot ---
bot.command('chaybot', async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId) && (!users[userId] || !users[userId].keyUsed)) {
        return ctx.reply('Bạn cần kích hoạt bot bằng key trước. Vui lòng gõ `/key <key_của_bạn>`');
    }

    // Đánh dấu người dùng này là active
    users[userId].active = true;
    saveData(USERS_FILE, users);

    if (!isBotRunningGlobally) {
        isBotRunningGlobally = true;
        // Bắt đầu interval gọi API nếu chưa chạy
        if (!apiIntervalId) {
            apiIntervalId = setInterval(fetchAndProcessApiData, API_INTERVAL);
            console.log('Bot bắt đầu lấy dữ liệu API.');
        }
        await ctx.reply(`Bot Sunwin đang khởi động...`);
    } else {
        await ctx.reply(`Bot Sunwin đã hoạt động rồi.`);
    }

    // Gửi dữ liệu hiện tại ngay lập tức nếu có, để người dùng không phải chờ phiên mới
    if (currentApiData) {
        ctx.reply(formatPredictionData(currentApiData), { parse_mode: 'Markdown' });
    } else {
        ctx.reply(`Đang chờ dữ liệu API mới nhất.`, { parse_mode: 'Markdown' });
    }
});

// --- Lệnh /tatbot ---
bot.command('tatbot', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId) && (!users[userId] || !users[userId].keyUsed)) {
        return ctx.reply('Bạn chưa kích hoạt bot, không thể dừng.');
    }

    // Dừng nhận tin nhắn cho user đó
    users[userId].active = false;
    saveData(USERS_FILE, users);
    ctx.reply('Bot Sunwin đã dừng. Bạn sẽ không nhận được dự đoán nữa.');

    // Kiểm tra nếu không còn user active nào (trừ admin chính nếu admin chính không tắt bot)
    const activeUsersCount = Object.values(users).filter(u => u.active && u.keyUsed && u.keyUsed !== 'admin').length;
    
    // Nếu không còn người dùng thường xuyên active và admin chính không yêu cầu chạy, hoặc admin chính tắt bot, thì dừng interval API
    if (activeUsersCount === 0 && !users[ADMIN_ID].active && isBotRunningGlobally) {
        clearInterval(apiIntervalId);
        apiIntervalId = null;
        isBotRunningGlobally = false;
        console.log('Không còn người dùng active, dừng lấy dữ liệu API.');
    } else if (userId === ADMIN_ID && !users[ADMIN_ID].active && isBotRunningGlobally) { // Admin chính tắt bot
        clearInterval(apiIntervalId);
        apiIntervalId = null;
        isBotRunningGlobally = false;
        console.log('Admin chính đã dừng bot, dừng lấy dữ liệu API.');
    }
});

// --- Lệnh Admin: /getkey ---
bot.command('getkey', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) {
        return ctx.reply('Bạn không có quyền sử dụng lệnh này.');
    }

    const args = ctx.message.text.split(' ').slice(1); // ['key_name', 'uses_limit', 'duration_value', 'duration_unit']
    if (args.length !== 4) {
        return ctx.reply(
            'Cú pháp: `/getkey <tên_key> <số_lượt_dùng> <giá_trị_thời_gian> <đơn_vị (h/d)>`' +
            '\n_Ví dụ: `/getkey abcxyz 10 2 d` (key abcxyz dùng 10 lần trong 2 ngày)_'
        );
    }

    const [keyName, usesLimitStr, durationValueStr, durationUnit] = args;
    const usesLimit = parseInt(usesLimitStr, 10);
    const durationValue = parseInt(durationValueStr, 10);

    if (isNaN(usesLimit) || usesLimit <= 0) {
        return ctx.reply('Số lượt sử dụng phải là số nguyên dương.');
    }
    if (isNaN(durationValue) || durationValue <= 0) {
        return ctx.reply('Thời gian phải là số nguyên dương.');
    }
    if (!['h', 'd'].includes(durationUnit)) {
        return ctx.reply('Đơn vị thời gian phải là `h` (giờ) hoặc `d` (ngày).');
    }

    if (keys[keyName]) {
        return ctx.reply(`Key \`${keyName}\` đã tồn tại. Vui lòng chọn tên key khác.`);
    }

    let expiresAt = null;
    if (durationUnit === 'h') {
        expiresAt = Date.now() + durationValue * 60 * 60 * 1000; // Giờ sang milliseconds
    } else if (durationUnit === 'd') {
        expiresAt = Date.now() + durationValue * 24 * 60 * 60 * 1000; // Ngày sang milliseconds
    }

    keys[keyName] = {
        uses: 0,
        maxUses: usesLimit,
        expiresAt: expiresAt,
        creatorId: userId,
        createdAt: new Date().toISOString()
    };
    saveData(KEYS_FILE, keys);
    ctx.reply(`Key \`${keyName}\` đã được tạo thành công! ` +
        `Sử dụng tối đa: ${usesLimit} lần. ` +
        `Hết hạn vào: ${expiresAt ? new Date(expiresAt).toLocaleString() : 'Không giới hạn'}.`);
});

// --- Lệnh Admin: /xoakey ---
bot.command('xoakey', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) {
        return ctx.reply('Bạn không có quyền sử dụng lệnh này.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const keyName = args[0];

    if (!keyName) {
        return ctx.reply('Vui lòng nhập tên key bạn muốn xóa. Ví dụ: `/xoakey ABCXYZ`');
    }

    if (keys[keyName]) {
        delete keys[keyName];
        saveData(KEYS_FILE, keys);
        // Xóa key đã sử dụng khỏi người dùng nếu có
        for (const uid in users) {
            if (users[uid].keyUsed === keyName) {
                users[uid].keyUsed = null;
                users[uid].active = false; // Đánh dấu là inactive khi key bị xóa
            }
        }
        saveData(USERS_FILE, users);
        ctx.reply(`Key \`${keyName}\` đã được xóa và gỡ bỏ khỏi người dùng.`);
    } else {
        ctx.reply(`Key \`${keyName}\` không tồn tại.`);
    }
});

// --- Lệnh Admin: /addadmin ---
bot.command('addadmin', (ctx) => {
    const userId = ctx.from.id;
    if (!isMainAdmin(userId)) { // Chỉ admin chính mới có quyền thêm admin phụ
        return ctx.reply('Bạn không có quyền thêm admin phụ.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const targetUserId = parseInt(args[0], 10);

    if (isNaN(targetUserId)) {
        return ctx.reply('Vui lòng nhập ID người dùng hợp lệ để thêm làm admin phụ.');
    }

    if (targetUserId === ADMIN_ID) {
        return ctx.reply('Người này đã là admin chính rồi.');
    }

    if (!users[targetUserId]) {
        users[targetUserId] = { active: false, keyUsed: null, isAdmin: false }; // Khởi tạo nếu chưa có
    }
    if (users[targetUserId].isAdmin) {
        return ctx.reply(`Người dùng ID ${targetUserId} đã là admin rồi.`);
    }

    users[targetUserId].isAdmin = true;
    users[targetUserId].active = true; // Coi như admin luôn active
    saveData(USERS_FILE, users);
    ctx.reply(`Người dùng ID \`${targetUserId}\` đã được thêm làm admin phụ.`);
    bot.telegram.sendMessage(targetUserId, 'Bạn đã được thêm làm admin phụ cho bot. Vui lòng gõ /start để xem các lệnh admin.', { parse_mode: 'Markdown' }).catch(e => {
        console.error(`Không thể thông báo cho admin mới ${targetUserId}:`, e.message);
    });
});

// --- Lệnh Admin: /xoaadmin ---
bot.command('xoaadmin', (ctx) => {
    const userId = ctx.from.id;
    if (!isMainAdmin(userId)) { // Chỉ admin chính mới có quyền xóa admin phụ
        return ctx.reply('Bạn không có quyền xóa admin phụ.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const targetUserId = parseInt(args[0], 10);

    if (isNaN(targetUserId)) {
        return ctx.reply('Vui lòng nhập ID người dùng hợp lệ để xóa admin.');
    }
    if (targetUserId === ADMIN_ID) {
        return ctx.reply('Không thể xóa admin chính.');
    }
    if (!users[targetUserId] || !users[targetUserId].isAdmin) {
        return ctx.reply(`Người dùng ID ${targetUserId} không phải là admin phụ.`);
    }

    users[targetUserId].isAdmin = false;
    saveData(USERS_FILE, users);
    ctx.reply(`Người dùng ID \`${targetUserId}\` đã bị xóa khỏi quyền admin phụ.`);
    bot.telegram.sendMessage(targetUserId, 'Bạn đã bị gỡ bỏ quyền admin phụ của bot.', { parse_mode: 'Markdown' }).catch(e => {
        console.error(`Không thể thông báo cho admin bị gỡ ${targetUserId}:`, e.message);
    });
});

// --- Lệnh Admin: /check ---
bot.command('check', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) {
        return ctx.reply('Bạn không có quyền sử dụng lệnh này.');
    }

    let userList = '--- *Danh sách Người dùng* ---\n\n';
    let userCount = 0;
    for (const id in users) {
        userCount++;
        const user = users[id];
        const status = user.active ? '✅ Active' : '❌ Inactive';
        const role = user.isAdmin ? (id == ADMIN_ID ? '👑 Main Admin' : '✨ Sub Admin') : '👤 User';
        const keyInfo = user.keyUsed ? `(Key: \`${user.keyUsed}\`)` : '';
        userList += `ID: \`${id}\` | Role: ${role} | Status: ${status} ${keyInfo}\n`;
    }
    userList += `\n*Tổng số người dùng*: ${userCount}`;

    let keyList = '\n\n--- *Danh sách Key* ---\n\n';
    let keyCount = 0;
    for (const keyName in keys) {
        keyCount++;
        const keyData = keys[keyName];
        const expires = keyData.expiresAt ? new Date(keyData.expiresAt).toLocaleString() : 'Không giới hạn';
        const remainingUses = keyData.maxUses - keyData.uses;
        keyList += `Key: \`${keyName}\` | Đã dùng: ${keyData.uses}/${keyData.maxUses} | Còn lại: ${remainingUses} | Hết hạn: ${expires}\n`;
    }
    keyList += `\n*Tổng số key*: ${keyCount}`;

    ctx.reply(userList + keyList, { parse_mode: 'Markdown' });
});

// --- Lệnh Admin: /thongbao ---
bot.command('thongbao', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) {
        return ctx.reply('Bạn không có quyền sử dụng lệnh này.');
    }

    const message = ctx.message.text.slice('/thongbao '.length).trim();
    if (!message) {
        return ctx.reply('Vui lòng nhập nội dung thông báo. Ví dụ: `/thongbao Bot sẽ bảo trì vào 22h tối nay.`');
    }

    sendBroadcastMessage(`📣 *THÔNG BÁO TỪ ADMIN:*\n\n${message}`);
    ctx.reply('Thông báo đã được gửi tới tất cả người dùng active.');
});

// --- Xử lý tin nhắn văn bản không phải lệnh ---
bot.on('text', (ctx) => {
    // Chỉ trả lời nếu tin nhắn không phải là một lệnh bắt đầu bằng '/'
    if (!ctx.message.text.startsWith('/')) {
        const userId = ctx.from.id;
        if (isAdmin(userId)) {
             ctx.reply('Admin: Bạn có thể dùng các lệnh quản lý bot hoặc `/start` để xem tất cả lệnh.');
        } else if (users[userId] && users[userId].keyUsed) {
             ctx.reply('Bạn có thể dùng lệnh `/chaybot` hoặc `/tatbot`.');
        } else {
             ctx.reply('Vui lòng dùng lệnh `/key <key_của_bạn>` để kích hoạt bot.');
        }
    }
});

// --- Khởi động bot ---
bot.launch()
    .then(() => {
        console.log('Bot Sunwin đã khởi động!');
        // Bắt đầu interval ngay khi bot khởi động nếu có ít nhất một user active HOẶC admin chính active
        const hasActiveUser = Object.values(users).some(u => u.active && u.keyUsed);
        if (hasActiveUser) {
            isBotRunningGlobally = true;
            apiIntervalId = setInterval(fetchAndProcessApiData, API_INTERVAL);
            console.log(`Bắt đầu lấy dữ liệu API mỗi ${API_INTERVAL / 1000} giây.`);

            // Gửi thông báo cho các user active đã kích hoạt key từ trước (trừ admin chính)
            for (const userId in users) {
                if (users[userId].active && users[userId].keyUsed && userId != ADMIN_ID) {
                    bot.telegram.sendMessage(userId, 'Bot Sunwin đã khởi động lại và đang hoạt động!').catch(e => {
                        console.error(`Không thể thông báo cho người dùng ${userId} về việc khởi động lại:`, e.message);
                    });
                }
            }
        } else {
            console.log('Không có người dùng active nào khi khởi động, bot chưa bắt đầu lấy dữ liệu API.');
        }
    })
    .catch((err) => {
        console.error('Lỗi khi khởi động Bot Sunwin:', err);
    });

// Bật các tín hiệu dừng linh hoạt (SIGINT, SIGTERM) để bot có thể đóng gracefully.
process.once('SIGINT', () => {
    console.log('Nhận tín hiệu SIGINT, đang dừng bot...');
    if (apiIntervalId) {
        clearInterval(apiIntervalId); // Dừng interval
    }
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('Nhận tín hiệu SIGTERM, đang dừng bot...');
    if (apiIntervalId) {
        clearInterval(apiIntervalId); // Dừng interval
    }
    bot.stop('SIGTERM');
});

