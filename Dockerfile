FROM node:18-slim

# Puppeteer ve Chromium için gerekli bağımlılıkları yüklüyoruz
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libglib2.0-0 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Çalışma dizinini ayarlıyoruz
WORKDIR /app

# Bağımlılıkları kopyalayıp kuruyoruz
COPY package*.json ./

# Puppeteer'ın kendi tarayıcısını indirmesini engelliyoruz
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=3000
ENV NODE_ENV=production

RUN npm install --omit=dev

# Proje dosyalarını kopyalıyoruz
COPY . .

# Uygulama portunu dışarı açıyoruz
EXPOSE 3000

# Uygulamayı başlatıyoruz
CMD ["node", "index.js"]
