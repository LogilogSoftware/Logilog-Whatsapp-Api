FROM node:18-slim

# Çalışma dizinini ayarlıyoruz
WORKDIR /app

# Bağımlılıkları kopyalayıp kuruyoruz
COPY package*.json ./
ENV PORT=3000
ENV NODE_ENV=production

# Baileys bağımlılıklarını kuruyoruz (Chromium/Puppeteer gerekmediği için çok hızlı kurulur)
RUN npm install --omit=dev

# Proje dosyalarını kopyalıyoruz
COPY . .

# Uygulama portunu dışarı açıyoruz
EXPOSE 3000

# Uygulamayı başlatıyoruz
CMD ["node", "index.js"]
