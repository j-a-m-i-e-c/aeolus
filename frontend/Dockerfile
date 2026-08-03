FROM node:22.22.1-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# Public demo flag, baked into the static bundle by Vite at build time. Defaults
# to false so normal builds are unchanged; the demo compose overlay sets it true.
ARG VITE_PUBLIC_DEMO=false
ENV VITE_PUBLIC_DEMO=$VITE_PUBLIC_DEMO
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
