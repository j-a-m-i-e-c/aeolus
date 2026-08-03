import rateLimit from "express-rate-limit";
import { config } from "../../config.js";

export const apiRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: config.rateLimitRpm,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

/**
 * Per-visitor limiter for public-demo automation state writes (public-demo-mode
 * spec, Req 9.1). Keyed by IP because every demo visitor shares the single
 * seeded `demo` user, so per-IP is the honest per-visitor bound and prevents one
 * visitor starving others. `skip` makes it a no-op for every non-demo session,
 * so normal installations and normal users are entirely unaffected.
 */
export const demoWriteRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user?.sessionType !== "public-demo",
  message: { error: "Too many demo state writes, please slow down" },
});

/** Per-visitor limiter for public-demo automation fire events (Req 9.1). */
export const demoFireRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user?.sessionType !== "public-demo",
  message: { error: "Too many demo fire requests, please slow down" },
});
