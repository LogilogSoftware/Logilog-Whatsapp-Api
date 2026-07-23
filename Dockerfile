FROM node:20-slim

# Puppeteer ve Chromium için gerekli sistem bağımlılıklarını kuruyoruz
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
ENV PORT=3000
ENV NODE_ENV=production

# Puppeteer'ın kendi Chromium'unu indirmesini engelleyip sistemdekini kullanmasını sağlıyoruz
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
