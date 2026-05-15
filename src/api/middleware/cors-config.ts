import cors from "cors";
import { config } from "../../config.js";

/**
 * CORS configuration for a self-hosted local-first platform.
 * 
 * Allows: localhost, 127.0.0.1, any .local hostname, any private IP (192.168.x, 10.x, 172.16-31.x),
 * plus any additional origins from the CORS_ORIGINS env var.
 */
function buildAllowedOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https?:\/\/[a-zA-Z0-9-]+\.local(:\d+)?$/,           // mDNS .local hostnames
    /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,             // 192.168.x.x
    /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,             // 10.x.x.x
    /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/, // 172.16-31.x.x
  ];
  for (const origin of config.corsOrigins) {
    if (origin) origins.push(origin);
  }
  return origins;
}

export const corsMiddleware = cors({
  origin: buildAllowedOrigins(),
  credentials: true,
});
