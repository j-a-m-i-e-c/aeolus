import cors from "cors";
import { config } from "../../config.js";

function buildAllowedOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
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
