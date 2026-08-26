FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Chromium do sistema pro puppeteer-core gerar o PDF do contrato (ver server/src/lib/contractPdf.ts)
# — o Chromium que o puppeteer normal baixaria sozinho não roda no Alpine (musl libc incompatível).
RUN apk add --no-cache chromium ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
