require('dotenv').config();
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

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

async function startWhatsapp() {
    // Oturum verilerini saklamak için Baileys multi-file auth kullanıyoruz
    const { state, saveCreds } = await useMultiFileAuthState('./.wwebjs_auth');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }) // Log kalabalığını önlemek için silent yapıyoruz
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            clientStatus = 'QR_READY';
            try {
                qrCodeImage = await qrcode.toDataURL(qr);
            } catch (err) {
                console.error('Failed to generate QR Code image:', err);
            }
        }

        if (connection === 'close') {
            clientStatus = 'DISCONNECTED';
            const errorReason = lastDisconnect?.error;
            const statusCode = errorReason instanceof Boom ? errorReason.output?.statusCode : null;
            
            console.log(`Connection closed due to: ${errorReason}. Status code: ${statusCode}`);

            // Eğer kullanıcı cihazı WhatsApp üzerinden silmediyse (loggedOut değilse) yeniden bağlanmayı dene
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('Reconnecting to WhatsApp...');
                setTimeout(startWhatsapp, 3000);
            } else {
                console.log('Logged out of WhatsApp. Please scan the QR code again.');
                // Oturum klasörünü temizleme ihtiyacı olabilir, bu durumda manuel QR gerekecektir.
                qrCodeImage = null;
            }
        } else if (connection === 'open') {
            clientStatus = 'READY';
            qrCodeImage = null;
            console.log('WhatsApp Client is READY (Baileys)!');
        }
    });
}

// WhatsApp İstemcisini Başlat
startWhatsapp().catch(err => {
    console.error('Error starting WhatsApp socket:', err);
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
        name: 'Logilog WhatsApp API Gateway (Baileys)',
        status: clientStatus,
        authenticated: clientStatus === 'READY'
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
 * @api {post} /send-message Sürücülere Görev Bildirimi Gönderme API'si
 */
app.post('/send-message', authenticateApiKey, async (req, res) => {
    let { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Phone and message fields are required' });
    }

    if (clientStatus !== 'READY' || !sock) {
        return res.status(503).json({ success: false, error: 'WhatsApp socket is not ready. Current status: ' + clientStatus });
    }

    try {
        let cleanPhone = phone.toString().replace(/\D/g, '');

        if (cleanPhone.length === 10 && cleanPhone.startsWith('5')) {
            cleanPhone = '90' + cleanPhone;
        }

        // Baileys formatında chatId: 905xxxxxxxxx@s.whatsapp.net
        const chatId = `${cleanPhone}@s.whatsapp.net`;

        // Mesajı gönder
        const sentMsg = await sock.sendMessage(chatId, { text: message });

        res.json({
            success: true,
            message: 'Message sent successfully',
            messageId: sentMsg.key.id,
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
