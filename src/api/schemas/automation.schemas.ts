import { z } from "zod";

export const createAutomationBodySchema = z.object({
  name: z.string().min(1).max(200),
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
