FROM node:22.22.1-slim AS builder
WORKDIR /app

# Build info passed as build args instead of copying .git
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN echo "{\"commit\":\"${BUILD_COMMIT}\",\"buildDate\":\"${BUILD_DATE}\"}" > /tmp/build-info.json
RUN npm run build

# Production stage
FROM node:22.22.1-slim AS production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ wget curl ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r aeolus && useradd -r -g aeolus -d /app -s /sbin/nologin aeolus

COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist/
COPY --from=builder /tmp/build-info.json ./dist/build-info.json
COPY src/automations/sandbox-types.d.ts ./dist/automations/sandbox-types.d.ts
COPY src/automations/ui-types.d.ts ./dist/automations/ui-types.d.ts

RUN mkdir -p /app/data && chown -R aeolus:aeolus /app

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# NOTE: the container starts as root so the entrypoint can repair the data
# volume's ownership, then immediately drops to the unprivileged "aeolus" user
# via gosu before exec'ing the app. The Node process never runs as root.
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:3001/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--max-old-space-size=1024", "dist/index.js"]
