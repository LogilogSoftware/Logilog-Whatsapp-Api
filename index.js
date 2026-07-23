require('dotenv').config();
const logBuffer = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const util = require('util');

console.log = (...args) => {
    logBuffer.push(`[LOG] ${new Date().toISOString()} - ${args.map(a => typeof a === 'string' ? a : util.inspect(a, { depth: 2 })).join(' ')}`);
    if (logBuffer.length > 200) logBuffer.shift();
    originalLog(...args);
};

console.error = (...args) => {
    logBuffer.push(`[ERROR] ${new Date().toISOString()} - ${args.map(a => typeof a === 'string' ? a : util.inspect(a, { depth: 2 })).join(' ')}`);
    if (logBuffer.length > 200) logBuffer.shift();
    originalError(...args);
};

console.warn = (...args) => {
    logBuffer.push(`[WARN] ${new Date().toISOString()} - ${args.map(a => typeof a === 'string' ? a : util.inspect(a, { depth: 2 })).join(' ')}`);
    if (logBuffer.length > 200) logBuffer.shift();
    originalWarn(...args);
};

const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const AUTH_DIR = process.env.AUTH_DIR || './.baileys_auth';

function clearAuthFolder() {
    const authPath = AUTH_DIR;
    if (!fs.existsSync(authPath)) return;
    
    try {
        const files = fs.readdirSync(authPath);
        for (const file of files) {
            const filePath = path.join(authPath, file);
            try {
                fs.rmSync(filePath, { recursive: true, force: true });
            } catch (e) {
                // Silinirken geçici kilitlenme olursa yoksay
            }
        }
        console.log(`[WhatsApp] Eski ${authPath} oturum klasörü başarıyla temizlendi.`);
    } catch (e) {
        console.error(`[WhatsApp] ${authPath} klasörü silinirken hata oluştu:`, e.message);
    }
}

function removeChromeLocks() {
    try {
        const lockPaths = [
            path.join(AUTH_DIR, 'session', 'SingletonLock'),
            path.join(AUTH_DIR, 'session', 'Default', 'SingletonLock'),
            path.join(AUTH_DIR, 'SingletonLock')
        ];
        
        for (const lockPath of lockPaths) {
            try {
                if (fs.existsSync(lockPath) || fs.lstatSync(lockPath).isSymbolicLink()) {
                    fs.unlinkSync(lockPath);
                    console.log(`[WhatsApp] Eski kilit dosyası silindi: ${lockPath}`);
                }
            } catch (err) {
                // Yoksay
            }
        }
    } catch (e) {
        console.error('[WhatsApp] Kilit dosyaları temizlenirken hata:', e.message);
    }
}

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.API_KEY || 'logilog-secret-key';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global durum değişkenleri
let qrCodeImage = null;
let clientStatus = 'INITIALIZING'; // INITIALIZING, QR_READY, CONNECTING, READY, DISCONNECTED
let client = null;
let isInitializing = false;

async function startWhatsapp() {
    if (isInitializing) {
        console.log('[WhatsApp] Bağlantı zaten başlatılıyor, mükerrer başlatma engellendi.');
        return;
    }
    isInitializing = true;
    clientStatus = 'CONNECTING';

    try {
        console.log('[WhatsApp] Eski kilit dosyaları temizleniyor...');
        removeChromeLocks();

        console.log('Initializing WhatsApp connection (whatsapp-web.js)...');

        client = new Client({
            authStrategy: new LocalAuth({
                dataPath: AUTH_DIR // Railway Volume ile uyumluluk için
            }),
            puppeteer: {
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        client.on('qr', async (qr) => {
            clientStatus = 'QR_READY';
            console.log('[WhatsApp] Yeni QR kodu alındı, terminalde ve web arayüzünde gösteriliyor.');
            qrcodeTerminal.generate(qr, { small: true });
            try {
                qrCodeImage = await qrcode.toDataURL(qr);
            } catch (err) {
                console.error('[WhatsApp] QR Kod görseli oluşturulamadı:', err.message);
            }
        });

        client.on('ready', () => {
            isInitializing = false;
            clientStatus = 'READY';
            qrCodeImage = null;
            const userPhone = client.info?.wid?.user || 'Bilinmiyor';
            console.log(`[WhatsApp] WhatsApp İstemcisi HAZIR (whatsapp-web.js)! Bağlı Hesap: ${userPhone}`);
        });

        client.on('auth_failure', (msg) => {
            isInitializing = false;
            clientStatus = 'DISCONNECTED';
            qrCodeImage = null;
            console.error('[WhatsApp] Kimlik doğrulama başarısız:', msg);
        });

        client.on('disconnected', (reason) => {
            isInitializing = false;
            clientStatus = 'DISCONNECTED';
            qrCodeImage = null;
            console.log('[WhatsApp] Bağlantı kapandı. Neden:', reason);
            
            // Bağlantı koptuğunda 5 saniye sonra otomatik yeniden başlat
            setTimeout(startWhatsapp, 5000);
        });

        await client.initialize();

    } catch (err) {
        isInitializing = false;
        console.error('[WhatsApp] BAĞLANTI HATASI:', err.message || err);
        clientStatus = 'DISCONNECTED';
        console.log('[WhatsApp] 5 saniye sonra tekrar deneniyor...');
        setTimeout(startWhatsapp, 5000);
    }
}

// WhatsApp İstemcisini Başlat
startWhatsapp().catch(err => {
    console.error('Error starting WhatsApp client:', err);
});

// --- API Güvenlik Ara Katmanı (Middleware) ---
const authenticateApiKey = (req, res, next) => {
    const receivedKey = req.headers['x-api-key'] || req.query.api_key;
    const maskedReceived = receivedKey ? (receivedKey.length > 4 ? receivedKey.substring(0, 3) + '...' : '***') : 'YOK';
    const maskedExpected = apiKey ? (apiKey.length > 4 ? apiKey.substring(0, 3) + '...' : '***') : 'YOK';
    
    console.log(`[API] Kimlik doğrulama isteği alındı. Gelen Key: ${maskedReceived}`);
    if (!receivedKey || receivedKey !== apiKey) {
        console.warn(`[API] Yetkisiz erişim denemesi! Beklenen Key: ${maskedExpected}, Gelen Key: ${maskedReceived}`);
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
    }
    next();
};

// --- API Uç Noktaları (Endpoints) ---

/**
 * @api {get} / Durum ve genel bilgi
 */
app.get('/', (req, res) => {
    res.json({
        name: 'Logilog WhatsApp API Gateway (whatsapp-web.js)',
        status: clientStatus,
        authenticated: clientStatus === 'READY',
        connectedNumber: client?.info?.wid?.user || null
    });
});

/**
 * @api {get} /qr QR Kodunu görsel olarak görüntüler (Tarayıcıdan okutmak için)
 */
app.get('/qr', (req, res) => {
    if (clientStatus === 'READY') {
        return res.send(`
            <html>
                <head>
                    <title>WhatsApp API - Connected</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f4f7f6; color: #333; }
                        .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; }
                        h1 { color: #25D366; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>WhatsApp Bağlantısı Aktif!</h1>
                        <p>Cihazınız başarıyla bağlandı (whatsapp-web.js).</p>
                        <p>Durum: <strong>${clientStatus}</strong></p>
                    </div>
                </body>
            </html>
        `);
    }

    if (!qrCodeImage) {
        return res.send(`
            <html>
                <head>
                    <title>WhatsApp API - Waiting for QR</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f4f7f6; color: #333; }
                        .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; }
                    </style>
                    <script>
                        setTimeout(() => { window.location.reload(); }, 3000);
                    </script>
                </head>
                <body>
                    <div class="card">
                        <h1>QR Kod Hazırlanıyor...</h1>
                        <p>Lütfen bekleyin, WhatsApp QR kodu oluşturuluyor. Sayfa otomatik yenilenecektir.</p>
                        <p>Mevcut Durum: <strong>${clientStatus}</strong></p>
                    </div>
                </body>
            </html>
        `);
    }

    res.send(`
        <html>
            <head>
                <title>WhatsApp API - Scan QR</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f4f7f6; color: #333; }
                    .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; }
                    img { margin: 20px 0; border: 1px solid #ddd; padding: 10px; background: white; }
                    h1 { color: #075E54; }
                </style>
                <script>
                    setInterval(async () => {
                        try {
                            const res = await fetch('/');
                            const data = await res.json();
                            if (data.status === 'READY') {
                                window.location.reload();
                            }
                        } catch (e) {}
                    }, 5000);
                </script>
            </head>
            <body>
                <div class="card">
                    <h1>WhatsApp QR Kodu (whatsapp-web.js)</h1>
                    <p>Telefonunuzdan WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla adımlarını takip ederek aşağıdaki kodu taratın.</p>
                    <img src="${qrCodeImage}" alt="WhatsApp QR Code" />
                    <p>Mevcut Durum: <strong>${clientStatus}</strong></p>
                </div>
            </body>
        </html>
    `);
});

/**
 * @api {get} /status Detaylı Durum Sorgulama API'si
 */
app.get('/status', (req, res) => {
    res.json({
        success: true,
        status: clientStatus,
        authenticated: clientStatus === 'READY',
        hasQr: !!qrCodeImage
    });
});

/**
 * @api {get} /reset Oturumu Manuel Sıfırlama ve Yeni QR Oluşturma Uç Noktası
 */
app.get('/reset', async (req, res) => {
    console.log('[WhatsApp] Manuel sıfırlama isteği alındı. Oturum temizleniyor...');
    clientStatus = 'INITIALIZING';
    qrCodeImage = null;

    if (client) {
        try {
            await client.destroy();
        } catch (e) {
            console.error('[WhatsApp] Client destroy hatası:', e.message);
        }
        client = null;
    }

    setTimeout(() => {
        clearAuthFolder();
        setTimeout(startWhatsapp, 1500);
    }, 1000);

    res.send(`
        <html>
            <head>
                <title>WhatsApp API - Resetting</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f4f7f6; color: #333; }
                    .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; }
                    h1 { color: #d9534f; }
                </style>
                <script>
                    setTimeout(() => { window.location.href = '/qr'; }, 4000);
                </script>
            </head>
            <body>
                <div class="card">
                    <h1>Oturum Sıfırlanıyor...</h1>
                    <p>Eski oturum verileri temizleniyor ve yeni QR kodu oluşturuluyor.</p>
                    <p>Lütfen bekleyin, 4 saniye içinde QR kod sayfasına yönlendiriliyorsunuz...</p>
                </div>
            </body>
        </html>
    `);
});

/**
 * @api {get} /logs Sunucu Günlüklerini (Logları) Görüntüleme Uç Noktası
 */
app.get('/logs', (req, res) => {
    const key = req.query.key;
    if (key !== apiKey) {
        return res.status(401).send('Geçersiz API Anahtarı. Örn: /logs?key=SECRET');
    }
    res.send(`
        <html>
            <head>
                <title>WhatsApp API - Server Logs</title>
                <style>
                    body { font-family: monospace; background-color: #1e1e1e; color: #d4d4d4; padding: 20px; line-height: 1.4; }
                    .log { white-space: pre-wrap; word-break: break-all; margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 8px; }
                    .log-error { color: #f44336; font-weight: bold; }
                    .log-warn { color: #ffeb3b; }
                    h1 { color: #25D366; }
                </style>
                <script>
                    setTimeout(() => { window.location.reload(); }, 3000);
                </script>
            </head>
            <body>
                <h1>Sunucu Logları (Her 3 saniyede yenilenir)</h1>
                <div>
                    ${logBuffer.map(log => {
                        let cls = 'log';
                        if (log.startsWith('[ERROR]')) cls = 'log log-error';
                        else if (log.startsWith('[WARN]')) cls = 'log log-warn';
                        return `<div class="${cls}">${log.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
                    }).reverse().join('')}
                </div>
            </body>
        </html>
    `);
});

/**
 * @api {get} /send-test Kolay Test Gönderim Uç Noktası
 */
app.get('/send-test', async (req, res) => {
    const { phone, message, mediaUrl, key } = req.query;

    const maskedExpected = apiKey ? (apiKey.length > 4 ? apiKey.substring(0, 3) + '...' : '***') : 'YOK';
    const maskedReceived = key ? (key.length > 4 ? key.substring(0, 3) + '...' : '***') : 'YOK';

    console.log(`[API-TEST] Test isteği alındı. Gelen Key: ${maskedReceived}, Hedef: ${phone}, Media: ${mediaUrl || 'YOK'}`);

    if (key !== apiKey) {
        console.warn(`[API-TEST] Yetkisiz test erişimi! Beklenen: ${maskedExpected}, Gelen: ${maskedReceived}`);
        return res.status(401).send('Geçersiz API Anahtarı. Örn: /send-test?key=SECRET&phone=905xxxxxxxxx&message=Test');
    }

    if (!phone || !message) {
        return res.status(400).send('Telefon (phone) ve Mesaj (message) parametreleri zorunludur.');
    }

    if (clientStatus !== 'READY' || !client) {
        return res.status(503).send('WhatsApp hazır değil. Durum: ' + clientStatus);
    }

    try {
        let cleanPhone = phone.toString().replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('5')) {
            cleanPhone = '90' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('05')) {
            cleanPhone = '90' + cleanPhone.substring(1);
        }

        const chatId = `${cleanPhone}@c.us`;
        console.log(`[API-TEST] Numara kaydı sorgulanıyor: ${chatId}`);
        
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            console.warn(`[API-TEST] Numara WhatsApp'ta kayıtlı görünmüyor! Hedef: ${cleanPhone}`);
            return res.status(400).send(`Numara WhatsApp'ta kayıtlı görünmüyor! Hedef: ${cleanPhone}`);
        }

        let sentMsg;
        if (mediaUrl) {
            const media = await MessageMedia.fromUrl(mediaUrl);
            sentMsg = await client.sendMessage(chatId, media, { caption: message });
        } else {
            sentMsg = await client.sendMessage(chatId, message);
        }

        const messageId = sentMsg?.id?.id || sentMsg?.id?._serialized || 'Bilinmiyor';
        console.log(`[API-TEST] Test mesajı başarıyla gönderildi. ID: ${messageId}`);
        res.send(`Mesaj başarıyla gönderildi! ID: ${messageId}`);
    } catch (e) {
        console.error('[API-TEST] Test mesajı gönderilirken hata:', e.message);
        res.status(500).send('Hata oluştu: ' + e.message);
    }
});

/**
 * @api {post} /send-message Sürücülere Görev Bildirimi Gönderme API'si
 */
app.post('/send-message', authenticateApiKey, async (req, res) => {
    let { phone, message, mediaUrl } = req.body;
    console.log(`[API] Mesaj gönderme isteği alındı. Hedef: ${phone}, Mesaj Boyutu: ${message ? message.length : 0} karakter, Media URL: ${mediaUrl || 'YOK'}`);

    if (!phone || !message) {
        console.warn('[API] Eksik parametre: Telefon veya mesaj boş.');
        return res.status(400).json({ success: false, error: 'Phone and message fields are required' });
    }

    if (clientStatus !== 'READY' || !client) {
        console.warn(`[API] Mesaj gönderilemedi. WhatsApp hazır değil. Durum: ${clientStatus}`);
        return res.status(503).json({ success: false, error: 'WhatsApp client is not ready. Current status: ' + clientStatus });
    }

    try {
        let cleanPhone = phone.toString().replace(/\D/g, '');

        if (cleanPhone.length === 10 && cleanPhone.startsWith('5')) {
            cleanPhone = '90' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('05')) {
            cleanPhone = '90' + cleanPhone.substring(1);
        }

        const chatId = `${cleanPhone}@c.us`;
        console.log(`[API] Numara kaydı sorgulanıyor: ${chatId}`);

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            console.warn(`[API] Numara WhatsApp'ta kayıtlı değil: ${cleanPhone}`);
            return res.status(400).json({ success: false, error: `Phone number is not registered on WhatsApp: ${cleanPhone}` });
        }

        // Mesajı gönder
        let sentMsg;
        if (mediaUrl) {
            const media = await MessageMedia.fromUrl(mediaUrl);
            sentMsg = await client.sendMessage(chatId, media, { caption: message });
        } else {
            sentMsg = await client.sendMessage(chatId, message);
        }

        const messageId = sentMsg?.id?.id || sentMsg?.id?._serialized || 'Bilinmiyor';
        console.log(`[API] Mesaj başarıyla gönderildi. Mesaj ID: ${messageId}, Alıcı: ${chatId}`);
        res.json({
            success: true,
            message: 'Message sent successfully',
            messageId: messageId,
            to: chatId
        });

    } catch (error) {
        console.error('[API] Mesaj gönderilirken hata oluştu:', error);
        res.status(500).json({ success: false, error: 'Internal server error: ' + error.message });
    }
});

// Sunucuyu Başlat
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Default API Key: ${apiKey}`);
});
