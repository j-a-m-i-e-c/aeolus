FROM node:22.22.1-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# Public demo flag, baked into the static bundle by Vite at build time. Defaults
# to false so normal builds are unchanged; the demo compose overlay sets it true.
ARG VITE_PUBLIC_DEMO=false
ENV VITE_PUBLIC_DEMO=$VITE_PUBLIC_DEMO
# Public API/WebSocket origin, baked in at build time. Needed when the dashboard
# is served from a different origin than the default `http://<host>:3001` — e.g.
# behind a single Cloudflare Tunnel origin for the public demo, where the tunnel
# path-routes /api and /ws to the backend. Empty by default so normal LAN builds
# keep their existing same-host behaviour.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_WS_URL=
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.4-alpine-slim
COPY --chown=101:0 --from=builder /app/dist /usr/share/nginx/html
COPY --chown=101:0 nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
