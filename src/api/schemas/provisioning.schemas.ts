import { z } from "zod";

// ─── MQTT Provisioning Schemas ───────────────────────────────────────────────

export const setSecurityLevelSchema = z.object({
  level: z.enum(["open", "shared_password", "per_device"]),
});

export const createDeviceCredentialSchema = z.object({
  deviceName: z.string().min(1).max(64).trim(),
});
