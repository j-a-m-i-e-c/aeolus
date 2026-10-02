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

const roleSchema = z.enum(["admin", "user"]);
const sessionDaysSchema = z.union([z.literal(1), z.literal(7), z.literal(30)]);
const inactivityMinutesSchema = z.union([z.literal(0), z.literal(30), z.literal(120), z.literal(480)]);

export const createUserSchema = z.object({
  username: z.string().min(1, "Username must not be empty"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  groupId: z.string().nullable(),
  role: roleSchema.optional(),
  sessionDays: sessionDaysSchema.optional(),
  inactivityMinutes: inactivityMinutesSchema.optional(),
});

export const updateUserSchema = z.object({
  groupId: z.string().nullable().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: roleSchema.optional(),
  sessionDays: sessionDaysSchema.optional(),
  inactivityMinutes: inactivityMinutesSchema.optional(),
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
