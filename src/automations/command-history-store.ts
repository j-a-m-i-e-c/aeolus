// src/automations/command-history-store.ts
// phase-1-runtime-foundations — durable command lifecycle timeline.
//
// This store is the SOLE owner of command-history SQLite access (design §1.3).
// PendingCommandTracker and other runtime components never touch the database;
// they report transitions and the composition layer drives this store. The
// store does not define its own lifecycle table — it obeys the central
// `canTransition()` guard so duplicate/late messages never create duplicate
// valid transitions (Req 3.6, 3.7).

import type { Database as DatabaseType } from "better-sqlite3";
import type { CommandLifecycleState, CommandFailureKind } from "../core/types.js";
import { canTransition } from "./command-lifecycle.js";
import type { ConfirmationTier } from "./command-lifecycle.js";
import logger from "../logger.js";

/** Origin kind of a Verified Command; mirrors {@link CommandSource} in command-service. */
export type CommandSourceKind = "automation" | "rest" | "system";

/** Failure classification persisted on a completed command, including restart interruption. */
export type CommandFailureReason = CommandFailureKind | "interrupted";

/** Durable summary of one Verified Command. `terminal_at` is the historical completion marker. */
export interface CommandRecord {
  commandId: string;
  correlationId?: string;
  sourceKind: CommandSourceKind;
  sourceId?: string;
  ruleId?: string;
  executionId?: string;
  causationId?: string;
  targetDeviceId: string;
  actionType: string;
  requestedTier?: ConfirmationTier;
  effectiveTier: ConfirmationTier;
  lifecycleState: CommandLifecycleState;
  success?: boolean;
  failureKind?: CommandFailureReason;
  error?: string;
  requestedAt: number;
  /** Historical column name: set when the configured command wait is complete. */
  terminalAt?: number;
}

/** One immutable lifecycle transition for a command. */
export interface CommandTransition {
  id: number;
  commandId: string;
  fromState?: CommandLifecycleState;
  toState: CommandLifecycleState;
  timestamp: number;
  details?: Record<string, unknown>;
}

/** A command record plus its chronological transition timeline. */
export interface CommandRecordWithTransitions extends CommandRecord {
  transitions: CommandTransition[];
}

/**
 * Notification emitted AFTER a lifecycle transition (or the initial REQUESTED
 * record) is durably written (phase-1 Req 7.5). Carries only fields safe for an
 * authenticated observer. The composition layer forwards it to the event bus.
 */
export interface CommandLifecycleTransitionEvent {
  commandId: string;
  correlationId?: string;
  targetDeviceId: string;
  sourceKind: CommandSourceKind;
  ruleId?: string;
  executionId?: string;
  fromState?: CommandLifecycleState;
  state: CommandLifecycleState;
  timestamp: number;
  terminal: boolean;
  success?: boolean;
}

/** Filters for a bounded recent-command listing. */
export interface CommandHistoryFilter {
  deviceId?: string;
  ruleId?: string;
  executionId?: string;
  state?: CommandLifecycleState;
  sourceKind?: CommandSourceKind;
  /** Clamped to [1, MAX_COMMAND_LIST_LIMIT]; defaults to DEFAULT_COMMAND_LIST_LIMIT. */
  limit?: number;
}

/** Input to a single lifecycle transition write. */
export interface CommandTransitionInput {
  commandId: string;
  /** Advisory previous state; the store uses the persisted current state for the guard. */
  fromState?: CommandLifecycleState;
  toState: CommandLifecycleState;
  timestamp: number;
  success?: boolean;
  failureKind?: CommandFailureReason;
  error?: string;
  /** When true, `terminal_at` is stamped so the configured command wait is complete. */
  terminal: boolean;
  details?: Record<string, unknown>;
}

export const DEFAULT_COMMAND_LIST_LIMIT = 50;
export const MAX_COMMAND_LIST_LIMIT = 200;

interface CommandRow {
  command_id: string;
  correlation_id: string | null;
  source_kind: string;
  source_id: string | null;
  rule_id: string | null;
  execution_id: string | null;
  causation_id: string | null;
  target_device_id: string;
  action_type: string;
  requested_tier: string | null;
  effective_tier: string;
  lifecycle_state: string;
  success: number | null;
  failure_kind: string | null;
  error: string | null;
  requested_at: number;
  terminal_at: number | null;
}

interface TransitionRow {
  id: number;
  command_id: string;
  from_state: string | null;
  to_state: string;
  timestamp: number;
  details: string | null;
}

function rowToRecord(row: CommandRow): CommandRecord {
  return {
    commandId: row.command_id,
    ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
    sourceKind: row.source_kind as CommandSourceKind,
    ...(row.source_id !== null ? { sourceId: row.source_id } : {}),
    ...(row.rule_id !== null ? { ruleId: row.rule_id } : {}),
    ...(row.execution_id !== null ? { executionId: row.execution_id } : {}),
    ...(row.causation_id !== null ? { causationId: row.causation_id } : {}),
    targetDeviceId: row.target_device_id,
    actionType: row.action_type,
    ...(row.requested_tier !== null ? { requestedTier: row.requested_tier as ConfirmationTier } : {}),
    effectiveTier: row.effective_tier as ConfirmationTier,
    lifecycleState: row.lifecycle_state as CommandLifecycleState,
    ...(row.success !== null ? { success: row.success === 1 } : {}),
    ...(row.failure_kind !== null ? { failureKind: row.failure_kind as CommandFailureReason } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    requestedAt: row.requested_at,
    ...(row.terminal_at !== null ? { terminalAt: row.terminal_at } : {}),
  };
}

function rowToTransition(row: TransitionRow): CommandTransition {
  return {
    id: row.id,
    commandId: row.command_id,
    ...(row.from_state !== null ? { fromState: row.from_state as CommandLifecycleState } : {}),
    toState: row.to_state as CommandLifecycleState,
    timestamp: row.timestamp,
    ...(row.details !== null ? { details: safeParse(row.details) } : {}),
  };
}

function safeParse(json: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Durable store for command records and their transition timelines.
 *
 * Construction is cheap; pass the shared better-sqlite3 handle. All writes are
 * synchronous and transactional. The store never re-dispatches or replays a
 * physical command — {@link reconcileInterrupted} only corrects the audit trail.
 */
export class CommandHistoryStore {
  /**
   * @param db shared better-sqlite3 handle.
   * @param onTransitionRecorded optional sink invoked AFTER a transition/record
   *   is durably committed (Req 7.5). A subscriber error never affects the write.
   */
  constructor(
    private readonly db: DatabaseType,
    private readonly onTransitionRecorded?: (event: CommandLifecycleTransitionEvent) => void,
  ) {}

  /** Forward a durably-recorded transition to the optional sink, never throwing. */
  private emitRecorded(event: CommandLifecycleTransitionEvent): void {
    if (!this.onTransitionRecorded) return;
    try {
      this.onTransitionRecorded(event);
    } catch (err) {
      logger.error(
        { commandId: event.commandId, error: (err as Error).message },
        "command lifecycle transition subscriber threw",
      );
    }
  }

  /**
   * Insert the initial durable record and its `REQUESTED` transition atomically.
   * The record must be created before dispatch is attempted (design §2.1).
   */
  create(record: CommandRecord): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO command_records (
            command_id, correlation_id, source_kind, source_id, rule_id, execution_id,
            causation_id, target_device_id, action_type, requested_tier, effective_tier,
            lifecycle_state, success, failure_kind, error, requested_at, terminal_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.commandId,
          record.correlationId ?? null,
          record.sourceKind,
          record.sourceId ?? null,
          record.ruleId ?? null,
          record.executionId ?? null,
          record.causationId ?? null,
          record.targetDeviceId,
          record.actionType,
          record.requestedTier ?? null,
          record.effectiveTier,
          record.lifecycleState,
          record.success === undefined ? null : record.success ? 1 : 0,
          record.failureKind ?? null,
          record.error ?? null,
          record.requestedAt,
          record.terminalAt ?? null,
        );
      this.db
        .prepare(
          "INSERT INTO command_transitions (command_id, from_state, to_state, timestamp, details) VALUES (?, ?, ?, ?, ?)",
        )
        .run(record.commandId, null, record.lifecycleState, record.requestedAt, null);
    });
    tx();

    this.emitRecorded({
      commandId: record.commandId,
      ...(record.correlationId ? { correlationId: record.correlationId } : {}),
      targetDeviceId: record.targetDeviceId,
      sourceKind: record.sourceKind,
      ...(record.ruleId ? { ruleId: record.ruleId } : {}),
      ...(record.executionId ? { executionId: record.executionId } : {}),
      state: record.lifecycleState,
      timestamp: record.requestedAt,
      terminal: record.terminalAt !== undefined,
      ...(record.success !== undefined ? { success: record.success } : {}),
    });
  }

  /** Attach a correlation id to an existing record (when assigned after creation). */
  setCorrelation(commandId: string, correlationId: string): void {
    this.db
      .prepare("UPDATE command_records SET correlation_id = ? WHERE command_id = ?")
      .run(correlationId, commandId);
  }

  /**
   * Record one lifecycle transition, updating the summary row and appending an
   * immutable transition row in a single transaction.
   *
   * Guarded by the central lifecycle table: a transition from the persisted
   * current state that is not allowed (or a repeat of the current state, or any
   * transition after the configured command wait has completed) is an idempotent no-op — no
   * duplicate row is written (Req 3.6, 3.7).
   */
  transition(input: CommandTransitionInput): void {
    let recorded: CommandLifecycleTransitionEvent | undefined;

    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT lifecycle_state, terminal_at, correlation_id, target_device_id, source_kind, rule_id, execution_id
             FROM command_records WHERE command_id = ?`,
        )
        .get(input.commandId) as
        | {
            lifecycle_state: string;
            terminal_at: number | null;
            correlation_id: string | null;
            target_device_id: string;
            source_kind: string;
            rule_id: string | null;
            execution_id: string | null;
          }
        | undefined;

      if (!current) {
        // No record to attribute the transition to. Never throw into the caller's
        // physical path; log and drop so history degrades rather than misreports.
        logger.error(
          { commandId: input.commandId, toState: input.toState },
          "CommandHistoryStore.transition: no command record found; transition dropped",
        );
        return;
      }

      const from = current.lifecycle_state as CommandLifecycleState;

      // Already completed, or a repeat of the current state, or a disallowed
      // advance → idempotent no-op.
      if (current.terminal_at !== null) return;
      if (from === input.toState) return;
      if (!canTransition(from, input.toState)) return;

      this.db
        .prepare(
          "INSERT INTO command_transitions (command_id, from_state, to_state, timestamp, details) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          input.commandId,
          from,
          input.toState,
          input.timestamp,
          input.details ? JSON.stringify(input.details) : null,
        );

      this.db
        .prepare(
          `UPDATE command_records
             SET lifecycle_state = ?,
                 success = COALESCE(?, success),
                 failure_kind = COALESCE(?, failure_kind),
                 error = COALESCE(?, error),
                 terminal_at = ?
           WHERE command_id = ?`,
        )
        .run(
          input.toState,
          input.success === undefined ? null : input.success ? 1 : 0,
          input.failureKind ?? null,
          input.error ?? null,
          input.terminal ? input.timestamp : null,
          input.commandId,
        );

      recorded = {
        commandId: input.commandId,
        ...(current.correlation_id !== null ? { correlationId: current.correlation_id } : {}),
        targetDeviceId: current.target_device_id,
        sourceKind: current.source_kind as CommandSourceKind,
        ...(current.rule_id !== null ? { ruleId: current.rule_id } : {}),
        ...(current.execution_id !== null ? { executionId: current.execution_id } : {}),
        fromState: from,
        state: input.toState,
        timestamp: input.timestamp,
        terminal: input.terminal,
        ...(input.success !== undefined ? { success: input.success } : {}),
      };
    });
    tx();

    // Emit only after the durable write commits (Req 7.5).
    if (recorded) this.emitRecorded(recorded);
  }

  /** Return a command with its chronological transition timeline, or undefined. */
  get(commandId: string): CommandRecordWithTransitions | undefined {
    const row = this.db
      .prepare("SELECT * FROM command_records WHERE command_id = ?")
      .get(commandId) as CommandRow | undefined;
    if (!row) return undefined;

    const transitions = (
      this.db
        .prepare("SELECT * FROM command_transitions WHERE command_id = ? ORDER BY id ASC")
        .all(commandId) as TransitionRow[]
    ).map(rowToTransition);

    return { ...rowToRecord(row), transitions };
  }

  /**
   * Return a bounded, newest-first list of command records matching the filter.
   * Never returns an unbounded result: the limit is clamped to
   * [1, {@link MAX_COMMAND_LIST_LIMIT}] and defaults to
   * {@link DEFAULT_COMMAND_LIST_LIMIT} (Req 7.4).
   */
  list(filter: CommandHistoryFilter = {}): CommandRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.deviceId !== undefined) {
      clauses.push("target_device_id = ?");
      params.push(filter.deviceId);
    }
    if (filter.ruleId !== undefined) {
      clauses.push("rule_id = ?");
      params.push(filter.ruleId);
    }
    if (filter.executionId !== undefined) {
      clauses.push("execution_id = ?");
      params.push(filter.executionId);
    }
    if (filter.state !== undefined) {
      clauses.push("lifecycle_state = ?");
      params.push(filter.state);
    }
    if (filter.sourceKind !== undefined) {
      clauses.push("source_kind = ?");
      params.push(filter.sourceKind);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = clampLimit(filter.limit);

    const rows = this.db
      .prepare(
        `SELECT * FROM command_records ${where} ORDER BY requested_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...params, limit) as CommandRow[];

    return rows.map(rowToRecord);
  }

  /** Return the current persisted lifecycle state of a command, if it exists. */
  currentState(commandId: string): CommandLifecycleState | undefined {
    const row = this.db
      .prepare("SELECT lifecycle_state FROM command_records WHERE command_id = ?")
      .get(commandId) as { lifecycle_state: string } | undefined;
    return row?.lifecycle_state as CommandLifecycleState | undefined;
  }

  /** Look up a command id by its correlation id, if one is recorded. */
  findByCorrelation(correlationId: string): string | undefined {
    const row = this.db
      .prepare("SELECT command_id FROM command_records WHERE correlation_id = ?")
      .get(correlationId) as { command_id: string } | undefined;
    return row?.command_id;
  }

  /**
   * Reconcile records that were still in-flight when the process stopped.
   *
   * The candidate set is defined by `terminal_at IS NULL` — never by the
   * lifecycle-state name (design §1.2, §4) — because the in-memory tracker that
   * owned the live wait cannot survive a restart. Each such record becomes a
   * terminal `FAILED` with `failure_kind = "interrupted"` and a transition row.
   * No physical command is ever replayed. Idempotent: after running, every
   * touched row has `terminal_at` set and is excluded from later runs.
   *
   * @returns the number of records reconciled.
   */
  reconcileInterrupted(now: number): number {
    const stale = this.db
      .prepare("SELECT command_id, lifecycle_state FROM command_records WHERE terminal_at IS NULL")
      .all() as Array<{ command_id: string; lifecycle_state: string }>;

    let reconciled = 0;
    for (const row of stale) {
      const from = row.lifecycle_state as CommandLifecycleState;
      // Guard defensively; REQUESTED/DISPATCHED/ACKNOWLEDGED all allow → FAILED.
      if (from !== "FAILED" && !canTransition(from, "FAILED")) continue;
      this.transition({
        commandId: row.command_id,
        fromState: from,
        toState: "FAILED",
        timestamp: now,
        success: false,
        failureKind: "interrupted",
        error: "Process restarted while the command was in flight; live confirmation wait was lost",
        terminal: true,
      });
      reconciled += 1;
    }

    if (reconciled > 0) {
      logger.warn({ reconciled }, "Reconciled interrupted command records after restart");
    }
    return reconciled;
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_COMMAND_LIST_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 1) return 1;
  if (floored > MAX_COMMAND_LIST_LIMIT) return MAX_COMMAND_LIST_LIMIT;
  return floored;
}
