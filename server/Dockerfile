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
RUN apk add --no-cache chromium ttf-freefont ffmpeg
# ffmpeg do sistema monta o vídeo do tabloide do Mercado Nunes (lib/tabloide/render.ts).
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Arquivos do Demo Studio (frames WebP, miniaturas, snapshots). No Easypanel, montar um volume em /data —
# sem ele as imagens somem a cada deploy.
ENV STORAGE_DIR=/data
RUN mkdir -p /data
# Telas do template "NX Systems — Tour completo", importadas no primeiro boot (lib/demoStudio/seed.ts).
COPY seed ./seed
# Logo do Mercado Nunes que entra no tabloide gerado no servidor.
COPY assets ./assets
EXPOSE 3001
CMD ["node", "dist/index.js"]
