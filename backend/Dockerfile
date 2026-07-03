# Backend image — Node 24 (matches dev). Prod deps only.
FROM node:24-alpine

WORKDIR /app

# Install deps first for layer caching. package.json lives at repo root.
COPY package.json ./
RUN npm install --omit=dev

# App source + migrations.
COPY backend ./backend

ENV NODE_ENV=production
CMD ["node", "backend/src/server.js"]
