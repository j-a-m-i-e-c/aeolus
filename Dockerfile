FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
COPY .git ./.git
RUN echo "{\"commit\":\"$(git rev-parse --short HEAD)\",\"buildDate\":\"$(git log -1 --format=%cI HEAD)\"}" > /tmp/build-info.json
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsup src/index.ts --format esm --target node22 --external isolated-vm --external better-sqlite3 --external bcrypt --external esbuild

# Production stage
FROM node:22-slim AS production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ wget curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist/
COPY --from=builder /tmp/build-info.json ./dist/build-info.json
COPY src/automations/sandbox-types.d.ts ./dist/automations/sandbox-types.d.ts
COPY automations/ ./automations/
RUN mkdir -p /app/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:3001/api/health || exit 1
CMD ["node", "--max-old-space-size=1024", "dist/index.js"]
