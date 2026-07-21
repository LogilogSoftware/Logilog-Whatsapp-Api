# Logilog WhatsApp API Gateway

Bu proje, **Logilog** sürücülerine görev bildirimleri göndermek amacıyla geliştirilmiş, **Railway** ortamında çalışmak üzere optimize edilmiş Express.js tabanlı bir WhatsApp Web API köprüsüdür.

## Özellikler

*   **whatsapp-web.js** kütüphanesi kullanarak WhatsApp Web oturumu yönetimi.
*   **Railway Nixpacks** desteği ile otomatik Chromium kurulumu ve Puppeteer entegrasyonu.
*   API güvenliği için `API_KEY` (x-api-key header) koruması.
*   Web arayüzünden QR Kod okutabilme (`/qr` endpoint'i).
*   Detaylı durum takibi (`/status` endpoint'i).
*   Güvenli mesaj gönderme endpoint'i (`/send-message`).



---

## Railway Dağıtımı (Deployment)

Bu repo Railway'e bağlandığında otomatik olarak Nixpacks aracılığıyla dağıtılır. `nixpacks.toml` dosyası, Puppeteer'ın çalışabilmesi için sisteme `chromium` paketini otomatik olarak kuracaktır.

### Gerekli Çevre Değişkenleri (Railway Variables)

Railway panelinizde "Variables" sekmesine giderek şu değişkenleri tanımlayın:

*   `API_KEY` : Sizin belirleyeceğiniz güçlü bir şifre (örn: `logilog-ozel-api-key-1234`)
*   `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` : `true`
*   `PUPPETEER_EXECUTABLE_PATH` : `/usr/bin/chromium`

### Kalıcı Oturum İçin (Railway Volume)

Railway'de container'lar her yeniden başladığında (redeploy veya restart durumunda) WhatsApp oturumunun düşmemesi için oturum klasörünü kalıcı kılmanız önerilir:

1.  Railway projenizde **Volume** oluşturun (örn: 1GB disk).
2.  Oluşturduğunuz Volume'ün **Mount Path** değerini `/.baileys_auth` veya `./.baileys_auth` olarak ayarlayın.
3.  Bu sayede giriş yaptıktan sonra sunucu kapansa dahi oturumunuz açık kalacaktır.

---

## API Kullanım Kılavuzu

### 1. Sistem Durumunu Sorgulama

*   **URL:** `/status` veya `/`
*   **Metot:** `GET`
*   **Yanıt Örneği:**
    ```json
    {
      "success": true,
      "status": "READY",
      "authenticated": true,
      "hasQr": false
    }
    ```
    *   `status` alabileceği değerler: `INITIALIZING`, `QR_READY`, `CONNECTING`, `READY`, `DISCONNECTED`

### 2. QR Kod Okutma

*   **URL:** `/qr`
*   **Metot:** `GET`
*   **Açıklama:** WhatsApp web oturumunu başlatmak için bu adrese tarayıcınızdan gidin ve ekrandaki QR kodunu telefonunuza okutun. Giriş tamamlandığında sayfa otomatik olarak güncellenecek ve durum `READY` olacaktır.

### 3. Sürücüye Mesaj Gönderme

Sürücülere görev bildirimi göndermek için bu API ucunu kullanın.

*   **URL:** `/send-message`
*   **Metot:** `POST`
*   **Headers:**
    *   `Content-Type`: `application/json`
    *   `x-api-key`: `.env` dosyasında veya Railway Variables'ta tanımladığınız `API_KEY` değeri.
*   **Body (JSON):**
    ```json
    {
      "phone": "905301234567",
      "message": "Merhaba Sayın Sürücü,\nYeni bir taşıma görevi atanmıştır. Detaylar için uygulamayı kontrol ediniz.\n\nLogilog Tedarik Yönetimi"
    }
    ```
    *   *Not:* Telefon numarası ülke kodu ile başlamalıdır. Türkiye için başında `90` olmalıdır. Numara sadece sayı içerebilir. Eğer 10 haneli (5xx xxx xx xx) gönderilirse, sistem otomatik olarak başına `90` ekleyecektir.
*   **Başarılı Yanıt Örneği (HTTP 200):**
    ```json
    {
      "success": true,
      "message": "Message sent successfully",
      "messageId": "true_905301234567@c.us_ABC123XYZ",
      "to": "905301234567@c.us"
    }
    ```
*   **Hata Yanıtı Örneği (HTTP 400 - Numara WhatsApp'ta yoksa):**
    ```json
    {
      "success": false,
      "error": "The phone number 905301234567 is not registered on WhatsApp."
    }
    ```
*   **Hata Yanıtı Örneği (HTTP 401 - Yetkisiz Erişim):**
    ```json
    {
      "success": false,
      "error": "Unauthorized: Invalid or missing API Key"
    }
    ```

---

### 4. Diğer Uygulamalardan API'ye İstek Atma Örnekleri

Kendi yazılımlarınızdan Logilog WhatsApp API'sine (Railway üzerindeki sunucunuza) mesaj göndermek için aşağıdaki kod örneklerini kullanabilirsiniz.

#### 💻 cURL (Terminal / Bash)
```bash
curl -X POST "https://logilogwhatsapp.up.railway.app/send-message" \
     -H "x-api-key: logilog-secret-key" \
     -H "Content-Type: application/json" \
     -d '{
           "phone": "05414764062",
           "message": "Merhaba! Bu cURL üzerinden gönderilmiş bir test mesajıdır."
         }'
```

#### 🌐 JavaScript (Fetch API / Node.js)
```javascript
const sendWhatsAppMessage = async () => {
    try {
        const response = await fetch('https://logilogwhatsapp.up.railway.app/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'logilog-secret-key' // Güvenlik anahtarınız
            },
            body: JSON.stringify({
                phone: '05414764062',
                message: 'Merhaba! JavaScript Fetch API üzerinden mesaj.'
            })
        });

        const data = await response.json();
        console.log(data);
    } catch (error) {
        console.error('Mesaj gönderilirken hata oluştu:', error);
    }
};

sendWhatsAppMessage();
```

#### 🐘 PHP (cURL)
```php
<?php
$curl = curl_init();

$payload = json_encode([
    "phone" => "05414764062",
    "message" => "Merhaba! PHP cURL üzerinden gönderilmiş bir mesajdır."
]);

curl_setopt_array($curl, [
    CURLOPT_URL => "https://logilogwhatsapp.up.railway.app/send-message",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_ENCODING => "",
    CURLOPT_MAXREDIRS => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_CUSTOMREQUEST => "POST",
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => [
        "Content-Type: application/json",
        "x-api-key: logilog-secret-key"
    ],
]);

$response = curl_exec($curl);
$err = curl_error($curl);
curl_close($curl);

if ($err) {
    echo "cURL Error #:" . $err;
} else {
    echo $response;
}
?>
```

#### 🔷 C# (HttpClient)
```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Program
{
    static async Task Main(string[] args)
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.Add("x-api-key", "logilog-secret-key");

        var jsonPayload = "{\"phone\": \"05414764062\", \"message\": \"Merhaba! C# üzerinden gönderilmiş mesaj.\"}";
        var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

        var response = await client.PostAsync("https://logilogwhatsapp.up.railway.app/send-message", content);
        var responseString = await response.Content.ReadAsStringAsync();
        
        Console.WriteLine(responseString);
    }
}
```
