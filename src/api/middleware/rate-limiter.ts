import rateLimit from "express-rate-limit";
import { config } from "../../config.js";

export const apiRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: config.rateLimitRpm,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
