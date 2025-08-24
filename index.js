Const { Telegraf, Markup } = require('telegraf');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const fetch = require('node-fetch');
// Cài đặt một trong hai thư viện proxy này, tùy thuộc vào loại proxy bạn có
const { HttpsProxyAgent } = require('https-proxy-agent'); // Dành cho HTTP/HTTPS proxy
// const { SocksProxyAgent } = require('socks-proxy-agent'); // Dành cho SOCKS proxy (thường là SOCKS5)

// --- Cấu hình Bot ---
const BOT_TOKEN = '7804059790:AAEFHgjLvJrBfSYUA3WPCEqspJUhVHBafXM'; // Token bot của bạn
const ADMIN_ID = 6781092017; // ID của admin chính
// ĐÃ THAY THẾ URL API MỚI
const API_URL = 'https://sunai.onrender.com/api/taixiu/sunwin'; // API URL của bạn
const API_INTERVAL = 3000; // Tần suất gọi API (3 giây)

// --- Cấu hình Proxy (CHỌN MỘT VÀ ĐIỀN THÔNG TIN CỦA BẠN VÀO ĐÂY) ---
// Thay thế 'your_proxy_ip', 'your_proxy_port', 'user', 'password' bằng thông tin thật của bạn.

// Nếu bạn dùng HTTP/HTTPS Proxy (thường dùng cho các dịch vụ proxy web):
const PROXY_URL = 'http://your_proxy_ip:your_proxy_port';
// Nếu proxy có xác thực: const PROXY_URL = 'http://user:password@your_proxy_ip:your_proxy_port';

// Hoặc nếu bạn dùng SOCKS5 Proxy (thường là proxy cá nhân để vượt tường lửa):
// const PROXY_URL = 'socks5://your_proxy_ip:your_proxy_port';
// Nếu proxy có xác thực: const PROXY_URL = 'socks5h://user:password@your_proxy_ip:your_proxy_port';


// --- Khởi tạo Bot với cấu hình Proxy ---
let bot;
if (PROXY_URL && PROXY_URL.startsWith('http')) {
    bot = new Telegraf(BOT_TOKEN, {
        telegram: {
            agent: new HttpsProxyAgent(PROXY_URL)
        }
    });
    console.log(`Bot khởi động với HTTP Proxy: ${PROXY_URL}`);
} else if (PROXY_URL && PROXY_URL.startsWith('socks')) {
    // Đảm bảo bạn đã uncomment dòng 'const { SocksProxyAgent } = require('socks-proxy-agent');' ở trên
    bot = new Telegraf(BOT_TOKEN, {
        telegram: {
            agent: new SocksProxyAgent(PROXY_URL)
        }
    });
    console.log(`Bot khởi động với SOCKS Proxy: ${PROXY_URL}`);
} else {
    // Không dùng proxy nếu PROXY_URL rỗng hoặc không hợp lệ
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
        if (users[userId].active) {
            bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' }).catch(e => {
                console.error(`Could not send message to user ${userId}:`, e.message);
                // Có thể đánh dấu user là inactive nếu lỗi do block bot
                if (e.message.includes('bot was blocked by the user')) {
                    users[userId].active = false;
                    saveData(USERS_FILE, users);
                }
            });
        }
    }
}

// --- ĐÃ CẬP NHẬT: Hàm định dạng dữ liệu API để hiển thị ---
function formatPredictionData(data) {
    if (!data) return "Không có dữ liệu dự đoán.";

    const PHIEN = data.Phien;
    const KET_QUA = data.Ket_qua;
    const DICE = `${data.Xuc_xac_1} - ${data.Xuc_xac_2} - ${data.Xuc_xac_3}`;
    const PHIEN_HIEN_TAI = data.Phien_hien_tai;
    const DU_DOAN = data.du_doan;
    const CAU = data.Pattern;

    return `
🎰 *TOOl SUNWIN V1 😘😘*
═════════════════════════════
*PHIÊN TRƯỚC*: ${PHIEN || 'N/A'}
*KẾT QUẢ*: ${KET_QUA || 'N/A'}
*DICE*: ${DICE || 'N/A'}
═════════════════════════════ 
*PHIÊN HIỆN TẠI*: ${PHIEN_HIEN_TAI || 'N/A'}
*DỰ ĐOÁN*: ${DU_DOAN || 'N/A'}
*CẦU*: ${CAU || 'N/A'}
═════════════════════════════ 
`.trim();
}

// --- Scheduler gọi API và cập nhật trạng thái ---
let apiIntervalId;
let isBotRunning = false; // Trạng thái bot

async function fetchAndProcessApiData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Kiểm tra nếu có phiên mới (sử dụng Phien_hien_tai từ API mới)
        if (data.Phien_hien_tai && data.Phien_hien_tai !== lastDisplayedSession) {
            console.log(`New session detected: ${data.Phien_hien_tai}`);
            // Cập nhật dữ liệu mới nhất
            currentApiData = data;
            lastDisplayedSession = data.Phien_hien_tai;

            // Ghi vào lịch sử dự đoán
            predictionHistory.push({
                timestamp: new Date().toISOString(),
                session: data.Phien_hien_tai,
                data: data
            });
            saveData(PREDICTION_HISTORY_FILE, predictionHistory);

            // Gửi dữ liệu mới tới tất cả người dùng active
            const formattedMessage = formatPredictionData(data);
            for (const userId in users) {
                if (users[userId].active && users[userId].keyUsed) { // Chỉ gửi cho user đã kích hoạt
                    bot.telegram.sendMessage(userId, formattedMessage, { parse_mode: 'Markdown' }).catch(e => {
                        console.error(`Could not send prediction to user ${userId}:`, e.message);
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
            // console.log('No new session, keeping current display.');
        }

    } catch (error) {
        console.error('Error fetching API data:', error.message);
        // Có thể gửi thông báo lỗi tới admin nếu muốn
        // bot.telegram.sendMessage(ADMIN_ID, `Lỗi API: ${error.message}`);
    }
}

// --- Lệnh /start ---
bot.start((ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name;

    // Ghi nhận người dùng mới
    if (!users[userId]) {
        users[userId] = { active: true, keyUsed: null, isAdmin: false };
        saveData(USERS_FILE, users);
        console.log(`New user started bot: ${userId} (${userName})`);
    } else {
        users[userId].active = true; // Đảm bảo active nếu họ đã dừng trước đó
        saveData(USERS_FILE, users);
    }

    if (isAdmin(userId)) {
        ctx.reply(
            `Xin chào Admin ${userName}! 👋 Bạn có thể dùng các lệnh quản lý bot.` +
            '\n\n*Các lệnh cho Admin:*\n' +
            '/getkey `<key_name>` `<uses_limit>` `<duration_value>` `<duration_unit (h/d)>` - Tạo key mới\n' +
            '  _Ví dụ: `/getkey abcxyz 10 2 d` (key abcxyz dùng 10 lần trong 2 ngày)_\n' +
            '/xoakey `<key_name>` - Xóa key đã tạo\n' +
            '/addadmin `<user_id>` - Thêm admin phụ (chỉ admin chính dùng)\n' +
            '/xoaadmin `<user_id>` - Xóa admin phụ (chỉ admin chính dùng)\n' +
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
            'Tool Bot Sunwin V1😘😘\n' +
            'Ko đảm bảo 100% ăn\n' +
            'Tool Bot By Tuấn Tú\n' +
            'Đó nó sẽ liên kết với api\n' +
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

    if (isBotRunning) {
        return ctx.reply('Bot Sun winn đã và đang hoạt động rồi.');
    }

    isBotRunning = true;
    users[userId].active = true; // Đảm bảo user active
    saveData(USERS_FILE, users);

    // Gửi dữ liệu hiện tại ngay lập tức nếu có
    if (currentApiData) {
        await ctx.reply(`Bot Sun winn đang khởi động...`);
        ctx.reply(formatPredictionData(currentApiData), { parse_mode: 'Markdown' });
    } else {
        ctx.reply(`Bot Sun winn đang khởi động... Đang chờ dữ liệu API mới nhất.`, { parse_mode: 'Markdown' });
    }

    // Bắt đầu interval gọi API
    if (!apiIntervalId) {
        apiIntervalId = setInterval(fetchAndProcessApiData, API_INTERVAL);
        console.log('Bot started fetching API data.');
    }
});

// --- Lệnh /tatbot ---
bot.command('tatbot', (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId) && (!users[userId] || !users[userId].keyUsed)) {
        return ctx.reply('Bạn chưa kích hoạt bot, không thể dừng.');
    }

    // Không dừng toàn bộ bot cho các user bình thường, chỉ dừng nhận tin nhắn cho user đó
    users[userId].active = false;
    saveData(USERS_FILE, users);

    // Nếu chỉ có admin hoặc không còn user active nào, mới dừng interval API
    const activeUsersCount = Object.values(users).filter(u => u.active && u.keyUsed).length;
    // Kiểm tra nếu không còn user active nào và người này không phải admin chính (nếu admin chính tắt thì dừng hẳn)
    if (activeUsersCount === 0 || (isMainAdmin(userId) && activeUsersCount === 0)) {
        clearInterval(apiIntervalId);
        apiIntervalId = null;
        isBotRunning = false;
        console.log('No active users or Main Admin stopped, stopping API fetching.');
    }

    ctx.reply('Bot Sun winn đã dừng. Bạn sẽ không nhận được dự đoán nữa.');
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
            'Cú pháp: `/getkey <key_name> <uses_limit> <duration_value> <duration_unit (h/d)>`' +
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
        console.error(`Could not notify new admin ${targetUserId}:`, e.message);
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
        console.error(`Could not notify removed admin ${targetUserId}:`, e.message);
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
    userList += `\nTổng số người dùng: ${userCount}`;

    let keyList = '\n\n--- *Danh sách Key* ---\n\n';
    let keyCount = 0;
    for (const keyName in keys) {
        keyCount++;
        const keyData = keys[keyName];
        const expires = keyData.expiresAt ? new Date(keyData.expiresAt).toLocaleString() : 'Không giới hạn';
        const remainingUses = keyData.maxUses - keyData.uses;
        keyList += `Key: \`${keyName}\` | Sử dụng: ${keyData.uses}/${keyData.maxUses} | Còn: ${remainingUses} | Hết hạn: ${expires}\n`;
    }
    keyList += `\nTổng số key: ${keyCount}`;

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
             ctx.reply('Admin: Bạn có thể dùng các lệnh quản lý bot hoặc `/help` để xem tất cả lệnh.');
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
        // Bắt đầu interval ngay khi bot khởi động để có dữ liệu ban đầu
        // và xử lý việc gửi cho các user active đã khởi động từ trước.
        apiIntervalId = setInterval(fetchAndProcessApiData, API_INTERVAL);
        console.log(`Bắt đầu lấy dữ liệu API mỗi ${API_INTERVAL / 1000} giây.`);

        // Nếu có người dùng active đã kích hoạt key từ trước, gửi thông báo cho họ
        for (const userId in users) {
            if (users[userId].active && users[userId].keyUsed && userId != ADMIN_ID) {
                bot.telegram.sendMessage(userId, 'Bot Sunwin đã khởi động lại và đang hoạt động!').catch(e => {
                    console.error(`Could not notify user ${userId} about restart:`, e.message);
                });
            }
        }
    })
    .catch((err) => {
        console.error('Lỗi khi khởi động Bot Sunwin:', err);
    });

// Bật các tín hiệu dừng linh hoạt (SIGINT, SIGTERM) để bot có thể đóng gracefully.
process.once('SIGINT', () => {
    console.log('SIGINT received, stopping bot...');
    clearInterval(apiIntervalId); // Dừng interval
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('SIGTERM received, stopping bot...');
    clearInterval(apiIntervalId); // Dừng interval
    bot.stop('SIGTERM');
});
