FROM node:20-slim

WORKDIR /app

COPY package*.json ./
ENV PORT=3000
ENV NODE_ENV=production

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
