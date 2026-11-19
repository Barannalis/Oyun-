# Virtual-money MVP. Real money is intentionally not enabled by this image.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_FILE=/data/platform.db
COPY package.json ./
COPY config ./config
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
# ADMIN_TOKEN must be supplied at runtime (at least 24 characters).
CMD ["sh", "-c", "node scripts/seed-demo.js && node --disable-warning=ExperimentalWarning src/index.js"]
