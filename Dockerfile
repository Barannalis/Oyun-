# Virtual-money MVP. Real money is intentionally not enabled by this image.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_FILE=/data/platform.db
COPY package.json ./
COPY config ./config
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data
# Runs as root on purpose: Render mounts the persistent disk root-owned, and a non-root
# user cannot write to it. The container itself has no other privileges.
VOLUME ["/data"]
EXPOSE 3000
# ADMIN_TOKEN must be supplied at runtime (at least 24 characters).
CMD ["sh", "-c", "node scripts/seed-demo.js && node --disable-warning=ExperimentalWarning src/index.js"]
