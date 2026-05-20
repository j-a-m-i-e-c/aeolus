FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsup src/index.ts --format esm --target node22 --external isolated-vm --external better-sqlite3 --external bcrypt

# Production stage — build tools needed for native addon compilation (isolated-vm, better-sqlite3)
FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache git docker-cli docker-cli-compose util-linux python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist/
COPY src/automations/sandbox-types.d.ts ./dist/automations/sandbox-types.d.ts
COPY automations/ ./automations/
RUN mkdir -p /app/data
# Allow git to operate on the mounted host project directory (different owner)
RUN git config --global --add safe.directory /aeolus-host
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1
CMD ["node", "--max-old-space-size=1024", "dist/index.js"]
