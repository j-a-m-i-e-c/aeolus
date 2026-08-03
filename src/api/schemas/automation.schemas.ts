import { z } from "zod";

export const createAutomationBodySchema = z.object({
  name: z.string().min(1).max(200),
  // Owning tab for non-admin (scoped) authoring. The requireTabPermission("write")
  // guard verifies the caller holds write on it; the create handler binds the new
  // automation's scope to it. Ignored for admins (who author unrestricted).
  tabId: z.string().max(100).optional(),
  triggerTopic: z.string().max(500).optional(),
  ruleType: z.enum(["form", "script"]).optional(),
  triggerType: z.enum(["mqtt", "cron", "none"]).optional(),
  cronExpression: z.string().max(200).optional(),
  conditionType: z.string().max(100).optional().nullable(),
  conditionValue: z.string().max(500).optional().nullable(),
  actionType: z.string().max(100).optional(),
  actionTarget: z.string().max(500).optional(),
  actionParams: z.record(z.string(), z.unknown()).optional(),
  scriptSource: z.string().max(102_400).optional(), // 100KB limit
  uiSource: z.string().max(102_400).optional().nullable(),
  enabled: z.boolean().optional(),
  completionTier: z.enum(["dispatch", "acknowledged", "observed"]).optional().nullable(),
});

export const updateAutomationBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  triggerTopic: z.string().max(500).optional(),
  triggerType: z.enum(["mqtt", "cron", "none"]).optional(),
  cronExpression: z.string().max(200).optional().nullable(),
  conditionType: z.string().max(100).optional().nullable(),
  conditionValue: z.string().max(500).optional().nullable(),
  actionType: z.string().max(100).optional(),
  actionTarget: z.string().max(500).optional(),
  actionParams: z.record(z.string(), z.unknown()).optional(),
  scriptSource: z.string().max(102_400).optional(),
  uiSource: z.string().max(102_400).optional().nullable(),
  completionTier: z.enum(["dispatch", "acknowledged", "observed"]).optional().nullable(),
});

export const automationIdParamsSchema = z.object({
  id: z.string().min(1).max(100),
});

export const toggleAutomationBodySchema = z.object({
  enabled: z.boolean(),
});

export const automationStateBodySchema = z.object({
  key: z.string().min(1).max(200),
  value: z.unknown(),
});

/**
 * Per-rule public-demo access allowlist (public-demo-mode spec). Authored by the
 * Aeolus project (admin-only) — declares which state keys a public-demo visitor
 * may write and which fire event names they may send for this automation.
 */
export const demoAccessBodySchema = z.object({
  writableStateKeys: z.array(z.string().min(1).max(64)).max(100).optional(),
  fireEvents: z.array(z.string().min(1).max(64)).max(100).optional(),
});
