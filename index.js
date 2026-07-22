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
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default || require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

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
        try {
            fs.rmSync(authPath, { recursive: true, force: true });
        } catch (e) {}
        console.log(`[WhatsApp] Eski ${authPath} oturum klasörü başarıyla temizlendi.`);
    } catch (e) {
        console.error(`[WhatsApp] ${authPath} klasörü silinirken hata oluştu:`, e.message);
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
let sock = null;

// Steel Logistics logosundan önceden üretilmiş doğru thumbnail (72x72 JPEG, base64)
// Bu sayede WhatsApp Web scroll sırasında arka planda yanlış resim göstermez
const STEEL_LOGO_THUMBNAIL = Buffer.from('/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABIAEgDASIAAhEBAxEB/8QAGgABAAMBAQEAAAAAAAAAAAAAAAECBgMFBP/EAC4QAAEDBAEEAQIEBwAAAAAAAAEAAgMEBRESIQYTMVFhFEEVImKBI0JSU3GRof/EABgBAQEBAQEAAAAAAAAAAAAAAAABAgME/8QAGBEBAQEBAQAAAAAAAAAAAAAAAAERIUH/2gAMAwEAAhEDEQA/AMAinCL07HJCIoyrolFGybfCaJRV2+E2+E0WRV2+ETRdRlRlRlYVJK+q22ytutR2aGndK4DLiOGsHtxPAH+V8a1HTMDqix1kQn0EtdTR9t7No5HHOGvwQQ0ng4/0l4RA6dtYpC193f3w7U1TYCaNrv6DJ7/V4Xi3O011qmEdbAWBwyyQHZkg9tcOCtq+4VVddexbqt1DXwfwX2eox9PKB5bHwBzjwRn5XldSvp29P/TwNfDrdJHCmewtNONBlnrg+jjlZlq2MiilFtkREQSoREBenZ7wbdHNTT0sVXRVBa6WF5LTlvhzXDlpGfK9fo6jjqqaoH4cZpnTMY2odSCpjjGOWuZkEZ87BdKR8VLa76JLfap5rdIxscgpw5rtpSDznkY8elm3xcfe2+0f0vfF/lbCG6aupwa9o/ttk8a/qWYvF6+vgjo6WlZSUMUhkbGHF73PIwXveeS4haCqoGN6PpZ6W2te+ShMkkjbeJPzZOSZdhqQPg+FbqK3R09midS21rYzTwOdK23jAyG7Hvbef2++FJi1h0Wh6xs1Rb71WTR0D4LeZg2F4ZiM8Dgf9WeWpdQREVQRW1CahXAjcGbcuGW4BacLp3IfAicBrggH7+1z1CahB0ErAzXV3lv8xxj7j907rSCCHYIOBscDnjhc9QmoQTLIH667AADILicn2qK2oTUJgqitqETBKIiqCIiAiIgIiICIiD//2Q==', 'base64');

let isInitializing = false;

async function startWhatsapp() {
    if (isInitializing) {
        console.log('[WhatsApp] Bağlantı zaten başlatılıyor, mükerrer başlatma engellendi.');
        return;
    }
    isInitializing = true;

    try {
        console.log('Initializing WhatsApp connection (Baileys)...');
        
        if (sock) {
            try {
                sock.ev.removeAllListeners();
                sock.ws?.close();
            } catch (e) {}
            sock = null;
        }

        // En son WhatsApp Web sürümünü çekiyoruz (405 hatasını önlemek için)
        let version = [2, 3000, 1017531287]; // Kararlı varsayılan sürüm
        try {
            const { version: latestVersion } = await fetchLatestBaileysVersion();
            if (latestVersion) {
                version = latestVersion;
                console.log(`Fetched latest WhatsApp Web version: ${version.join('.')}`);
            }
        } catch (e) {
            console.log('Could not fetch latest version, using fallback version:', version.join('.'));
        }

        // Oturum verilerini saklamak için Baileys multi-file auth kullanıyoruz
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        sock = makeWASocket({
            auth: state,
            version: version,
            browser: Browsers.macOS('Desktop'),
            logger: pino({ level: 'silent' }), // Baileys'in detaylı içsel oturum ve hata loglarını sessize alıyoruz
            qrTimeout: 60000, // QR süresini 60 sn tutuyoruz
            keepAliveIntervalMs: 30000, // Sunucu ile bağlantıyı canlı tutmak için her 30 sn'de bir ping atar
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            syncFullHistory: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection) {
                console.log('[WhatsApp] Bağlantı durumu:', connection);
            }

            if (qr) {
                clientStatus = 'QR_READY';
                console.log('[WhatsApp] Yeni QR kodu oluşturuldu.');
                try {
                    qrCodeImage = await qrcode.toDataURL(qr);
                } catch (err) {
                    console.error('[WhatsApp] QR Kod görseli oluşturulamadı:', err.message);
                }
            }

            if (connection === 'close') {
                isInitializing = false;
                clientStatus = 'DISCONNECTED';
                const errorReason = lastDisconnect?.error;
                const statusCode = errorReason instanceof Boom ? errorReason.output?.statusCode : null;
                const errMessage = errorReason?.message || 'Bilinmeyen Neden';
                
                console.log(`[WhatsApp] Bağlantı kapandı. Neden: ${errMessage} (Durum Kodu: ${statusCode || 'N/A'})`);

                const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
                const isBadSession = statusCode === DisconnectReason.badSession || statusCode === 400;
                const isQrTimedOut = errMessage.includes('QR refs attempts ended');

                if (isLoggedOut || isBadSession) {
                    console.log(`[WhatsApp] Oturum kapatıldı veya geçersiz (Durum: ${statusCode}). Oturum klasörü temizlenip yeniden başlatılıyor...`);
                    qrCodeImage = null;
                    
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners();
                            sock.ws?.close();
                        } catch (e) {}
                        sock = null;
                    }

                    setTimeout(() => {
                        clearAuthFolder();
                        setTimeout(startWhatsapp, 1500);
                    }, 1500);
                } else if (isQrTimedOut) {
                    console.log('[WhatsApp] QR kod tarama süresi doldu. Yeni QR kod oluşturuluyor...');
                    qrCodeImage = null;
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners();
                            sock.ws?.close();
                        } catch (e) {}
                        sock = null;
                    }
                    setTimeout(startWhatsapp, 1500);
                } else {
                    console.log('[WhatsApp] 3 saniye içinde yeniden bağlanılacak...');
                    setTimeout(startWhatsapp, 3000);
                }
            } else if (connection === 'open') {
                isInitializing = false;
                clientStatus = 'READY';
                qrCodeImage = null;
                const userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Bilinmiyor';
                console.log(`[WhatsApp] WhatsApp İstemcisi HAZIR (Baileys)! Bağlı Hesap: ${userPhone}`);
            }
        });
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
    console.error('Error starting WhatsApp socket:', err);
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
        name: 'Logilog WhatsApp API Gateway (Baileys)',
        status: clientStatus,
        authenticated: clientStatus === 'READY',
        connectedNumber: sock?.user?.id ? sock.user.id.split(':')[0] : null
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
                        <p>Cihazınız başarıyla bağlandı (Baileys).</p>
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
                    <h1>WhatsApp QR Kodu (Baileys)</h1>
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
app.get('/reset', (req, res) => {
    console.log('[WhatsApp] Manuel sıfırlama isteği alındı. Oturum temizleniyor...');
    clientStatus = 'INITIALIZING';
    qrCodeImage = null;

    if (sock) {
        try {
            sock.ev.removeAllListeners();
            sock.ws?.close();
        } catch (e) {}
        sock = null;
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

    if (clientStatus !== 'READY' || !sock) {
        return res.status(503).send('WhatsApp hazır değil. Durum: ' + clientStatus);
    }

    try {
        let cleanPhone = phone.toString().replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('5')) {
            cleanPhone = '90' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('05')) {
            cleanPhone = '90' + cleanPhone.substring(1);
        }

        console.log(`[API-TEST] Numarayı WhatsApp üzerinde sorguluyoruz: ${cleanPhone}`);
        const [resolved] = await sock.onWhatsApp(cleanPhone);
        console.log(`[API-TEST] Sorgu sonucu:`, resolved);

        if (!resolved || !resolved.exists) {
            console.warn(`[API-TEST] Numara WhatsApp'ta kayıtlı görünmüyor! Hedef: ${cleanPhone}`);
            return res.status(400).send(`Numara WhatsApp'ta kayıtlı görünmüyor! Hedef: ${cleanPhone}`);
        }

        // Yeni Multi-Device mimarisinde LID kullanmak gerekiyor, yoksa JID ile devam et
        const chatId = resolved.lid || resolved.jid;
        console.log(`[API-TEST] Kullanılan JID tipi: ${resolved.lid ? 'LID' : 'JID'}, Değer: ${chatId}`);

        let sentMsg;
        if (mediaUrl) {
            sentMsg = await sock.sendMessage(chatId, {
                image: { url: mediaUrl },
                caption: message,
                jpegThumbnail: STEEL_LOGO_THUMBNAIL
            });
        } else {
            sentMsg = await sock.sendMessage(chatId, { text: message });
        }

        console.log(`[API-TEST] Test mesajı başarıyla gönderildi. ID: ${sentMsg.key.id}`);
        res.send(`Mesaj başarıyla gönderildi! ID: ${sentMsg.key.id}`);
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

    if (clientStatus !== 'READY' || !sock) {
        console.warn(`[API] Mesaj gönderilemedi. WhatsApp hazır değil. Durum: ${clientStatus}`);
        return res.status(503).json({ success: false, error: 'WhatsApp socket is not ready. Current status: ' + clientStatus });
    }

    try {
        let cleanPhone = phone.toString().replace(/\D/g, '');

        if (cleanPhone.length === 10 && cleanPhone.startsWith('5')) {
            cleanPhone = '90' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('05')) {
            cleanPhone = '90' + cleanPhone.substring(1);
        }

        console.log(`[API] Numarayı WhatsApp üzerinde sorguluyoruz: ${cleanPhone}`);
        const [resolved] = await sock.onWhatsApp(cleanPhone);
        console.log(`[API] Sorgu sonucu:`, resolved);

        if (!resolved || !resolved.exists) {
            console.warn(`[API] Numara WhatsApp'ta kayıtlı değil: ${cleanPhone}`);
            return res.status(400).json({ success: false, error: `Phone number is not registered on WhatsApp: ${cleanPhone}` });
        }

        // Yeni Multi-Device mimarisinde LID kullanmak gerekiyor, yoksa JID ile devam et
        const chatId = resolved.lid || resolved.jid;
        console.log(`[API] Kullanılan JID tipi: ${resolved.lid ? 'LID' : 'JID'}, Değer: ${chatId}`);

        // Mesajı gönder
        let sentMsg;
        if (mediaUrl) {
            // jpegThumbnail olarak Steel Logistics logosunun doğru küçük versiyonunu gönder
            // Böylece WhatsApp Web scroll sırasında arka planda yanlış resim göstermez
            sentMsg = await sock.sendMessage(chatId, {
                image: { url: mediaUrl },
                caption: message,
                jpegThumbnail: STEEL_LOGO_THUMBNAIL
            });
        } else {
            sentMsg = await sock.sendMessage(chatId, { text: message });
        }

        console.log(`[API] Mesaj başarıyla gönderildi. Mesaj ID: ${sentMsg.key.id}, Alıcı: ${chatId}`);
        res.json({
            success: true,
            message: 'Message sent successfully',
            messageId: sentMsg.key.id,
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
