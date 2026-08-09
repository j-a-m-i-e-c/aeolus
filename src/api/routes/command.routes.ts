// src/api/routes/command.routes.ts
// phase-1-runtime-foundations Task 9 — authenticated command-history surfaces
// for later UI work (Req 7.1-7.4). Command history can disclose device names and
// behaviour, so these routes are admin-only (never unauthenticated).

import { Router } from "express";
import type {
  CommandHistoryStore,
  CommandHistoryFilter,
  CommandSourceKind,
} from "../../automations/command-history-store.js";
import type { CommandLifecycleState } from "../../core/types.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { NotFoundError } from "../middleware/error-handler.js";

const LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "REQUESTED",
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
]);

const SOURCE_KINDS: ReadonlySet<string> = new Set(["automation", "rest", "system"]);

export function createCommandRoutes(store: CommandHistoryStore): Router {
  const router = Router();

  /**
   * GET /api/commands — bounded, newest-first list with optional filters. The
   * store clamps the limit, so an unbounded full history is never returned.
   */
  router.get("/", requireAdmin, (req, res) => {
    const filter: CommandHistoryFilter = {};

    if (typeof req.query.deviceId === "string") filter.deviceId = req.query.deviceId;
    if (typeof req.query.ruleId === "string") filter.ruleId = req.query.ruleId;
    if (typeof req.query.executionId === "string") filter.executionId = req.query.executionId;
    if (typeof req.query.state === "string" && LIFECYCLE_STATES.has(req.query.state)) {
      filter.state = req.query.state as CommandLifecycleState;
    }
    if (typeof req.query.sourceKind === "string" && SOURCE_KINDS.has(req.query.sourceKind)) {
      filter.sourceKind = req.query.sourceKind as CommandSourceKind;
    }
    if (req.query.limit !== undefined) {
      const parsed = Number(req.query.limit);
      if (Number.isFinite(parsed)) filter.limit = parsed;
    }

    res.json(store.list(filter));
  });

  /**
   * GET /api/commands/:commandId — a single command with its chronological
   * transition timeline. 404 when the command id is unknown.
   */
  router.get("/:commandId", requireAdmin, (req, res, next) => {
    const commandId = req.params.commandId as string;
    const record = store.get(commandId);
    if (!record) {
      return next(new NotFoundError(`Command not found: ${commandId}`));
    }
    const { transitions, ...command } = record;
    return res.json({ command, transitions });
  });

  return router;
}
