import { z } from "zod";

// ─── Core Auth Schemas ───────────────────────────────────────────────────────

export const setupSchema = z.object({
  username: z.string().min(1, "Username must not be empty"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

// ─── User Management Schemas ─────────────────────────────────────────────────

export const createUserSchema = z.object({
  username: z.string().min(1, "Username must not be empty"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  groupId: z.string(),
});

export const updateUserSchema = z.object({
  groupId: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

// ─── Group Management Schemas ────────────────────────────────────────────────

const tabAssignmentSchema = z.object({
  tabId: z.string(),
  permission: z.enum(["read", "interact", "write"]),
});

export const createGroupSchema = z.object({
  name: z.string().min(1, "Group name must not be empty"),
  tabAssignments: z.array(tabAssignmentSchema),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1, "Group name must not be empty"),
  tabAssignments: z.array(tabAssignmentSchema),
});

// ─── MQTT Credential Schemas ─────────────────────────────────────────────────

export const createMqttCredentialSchema = z.object({
  deviceName: z.string().min(1, "Device name must not be empty"),
});
