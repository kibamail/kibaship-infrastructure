FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production && npm cache clean --force

COPY src/ ./src/
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "src/main.mjs"]
