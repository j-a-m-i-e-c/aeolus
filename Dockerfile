FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsup src/index.ts --format esm --target node20

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache git docker-cli docker-cli-compose python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist/
COPY src/automations/sandbox-types.d.ts ./dist/automations/sandbox-types.d.ts
COPY automations/ ./automations/
RUN mkdir -p /app/data
EXPOSE 3001
CMD ["node", "dist/index.js"]
