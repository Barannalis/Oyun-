# Derleme aşaması: bağımlılıkları kurar, yayın ekranı ve paneli derler, tipleri denetler.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci \
 && npm run typecheck \
 && npm run build \
 && npm prune --omit=dev

# Çalışma aşaması: yalnızca üretim bağımlılıkları ve derlenmiş dosyalar.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    OVERLAY_DIST=/app/apps/overlay/dist \
    GIFT_DB=/data/gifts.db
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]
