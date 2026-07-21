require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.API_KEY || 'logilog-secret-key'; // Varsayılan API Key

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global durum değişkenleri
let qrCodeImage = null;
let clientStatus = 'INITIALIZING'; // INITIALIZING, QR_READY, CONNECTING, READY, DISCONNECTED
let clientInfo = null;

// Railway ve Docker ortamlarında Puppeteer'ın düzgün çalışması için gerekli argümanlar eklenmiştir.
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.PORT;
const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || (isProduction ? '/usr/bin/chromium' : undefined);

if (isProduction) {
    console.log('Production environment detected. Using chromium path:', chromePath);
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        executablePath: chromePath
    }
});

// WhatsApp Olay Dinleyicileri (Event Listeners)
client.on('qr', async (qr) => {
    clientStatus = 'QR_READY';
    console.log('QR Code received, generate image...');
    try {
        qrCodeImage = await qrcode.toDataURL(qr);
    } catch (err) {
        console.error('Failed to generate QR Code image:', err);
    }
});

client.on('ready', () => {
    clientStatus = 'READY';
    qrCodeImage = null; // Bağlantı sağlandığı için QR kodu temizle
    clientInfo = client.info;
    console.log('WhatsApp Client is READY!');
});

client.on('authenticated', () => {
    console.log('WhatsApp Client authenticated successfully');
});

client.on('auth_failure', (msg) => {
    clientStatus = 'DISCONNECTED';
    console.error('WhatsApp Authentication failure:', msg);
});

client.on('disconnected', (reason) => {
    clientStatus = 'DISCONNECTED';
    console.log('WhatsApp Client disconnected:', reason);
    // Yeniden başlatmayı dene
    client.initialize();
});

// İstemciyi Başlat
client.initialize().catch(err => {
    console.error('Error during client initialization:', err);
});

// --- API Güvenlik Ara Katmanı (Middleware) ---
const authenticateApiKey = (req, res, next) => {
    const receivedKey = req.headers['x-api-key'] || req.query.api_key;
    if (!receivedKey || receivedKey !== apiKey) {
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
        name: 'Logilog WhatsApp API Gateway',
        status: clientStatus,
        authenticated: clientStatus === 'READY',
        info: clientInfo ? { pushname: clientInfo.pushname, wid: clientInfo.wid } : null
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
                        <p>Cihazınız zaten başarıyla bağlandı.</p>
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
                        // QR kodunun yüklenip yüklenmediğini kontrol etmek için sayfayı yeniler
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
                    // Bağlantı durumunu kontrol et, bağlandıysa sayfayı yenile
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
                    <h1>WhatsApp QR Kodu</h1>
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
 * @api {post} /send-message Sürücülere Görev Bildirimi Gönderme API'si
 * @apiHeader {String} x-api-key API Güvenlik Anahtarı
 * @apiBody {String} phone Alıcının telefon numarası (örn: 905xxxxxxxxx)
 * @apiBody {String} message Gönderilecek mesaj içeriği
 */
app.post('/send-message', authenticateApiKey, async (req, res) => {
    let { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Phone and message fields are required' });
    }

    if (clientStatus !== 'READY') {
        return res.status(503).json({ success: false, error: 'WhatsApp client is not ready. Current status: ' + clientStatus });
    }

    try {
        // Telefon numarasını temizle (sadece sayıları bırak)
        let cleanPhone = phone.toString().replace(/\D/g, '');

        // Eğer numara ülke kodu içermiyorsa ve Türkiye numarası varsayılıyorsa başına 90 ekleyebiliriz.
        // Ama en sağlıklısı kullanıcının ülke kodlu göndermesidir.
        // Eğer Türkiye numarası ise ve 5 ile başlıyorsa (10 haneliyse) başına 90 ekleyelim.
        if (cleanPhone.length === 10 && cleanPhone.startsWith('5')) {
            cleanPhone = '90' + cleanPhone;
        }

        // whatsapp-web.js için gerekli olan chatId formatını oluştur (örn: 905300000000@c.us)
        const chatId = `${cleanPhone}@c.us`;

        // Numaranın WhatsApp'ta kayıtlı olup olmadığını kontrol et
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({ success: false, error: `The phone number ${phone} is not registered on WhatsApp.` });
        }

        // Mesajı gönder
        const response = await client.sendMessage(chatId, message);

        res.json({
            success: true,
            message: 'Message sent successfully',
            messageId: response.id.id,
            to: chatId
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: 'Internal server error: ' + error.message });
    }
});

// Sunucuyu Başlat
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Default API Key: ${apiKey}`);
});
