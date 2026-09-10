// src/db/migrations/018-command-trigger-provenance.ts
// showcase-cleanup §2.7 — record what caused a command, not just what it did.

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * Snapshot, on each Verified Command, what triggered the execution that issued it.
 *
 * Commands are already linked to their automation execution by `execution_id`, so
 * grouping several physical commands under the one operator click is a query away.
 * What is missing is the answer to the obvious next question: what caused that
 * execution? A group header reading "3 commands · 2.1 s" is far less use than one
 * reading "Triggered by sensor/mine/gas".
 *
 * The alternative was to derive it in the UI from whatever the pane happened to
 * know — the button that was clicked, a label in the automation's own state. That
 * is guesswork dressed as provenance: it cannot describe an execution the operator
 * did not start, it silently disagrees with the record whenever the two drift, and
 * it produces nothing at all for a device-triggered execution. The trigger exists
 * in `ActiveExecutionContext` at acceptance time. Persisting it there is the only
 * version that is true for every execution rather than just the ones a human began.
 *
 * Three columns because the trigger is genuinely three separate facts, and
 * collapsing them would lose the distinction:
 *
 * - `trigger_kind` — the class of originator (`mqtt-device`, `connector`,
 *   `automation`, ...), present only when the triggering event carried metadata.
 * - `trigger_id` — the specific originator within that class, e.g. the device id.
 * - `trigger_topic` — the subject the rule fired on. Always available, because
 *   `EventContext.topic` always is, which makes it the reliable one. A manual or
 *   operator fire lands here as `ui/<ruleId>/<eventName>`.
 *
 * A command may therefore know its topic but not its kind. That is not a defect:
 * the fire path does not attach event metadata, so claiming a kind for an operator
 * click would mean inventing one.
 *
 * As with migration 017: every column is nullable, nothing is backfilled, and NULL
 * means "not recorded" rather than "no trigger". A pre-018 command was caused by
 * something; this schema simply never captured what.
 *
 * Idempotent: every column add is guarded by PRAGMA table_info, so re-applying is
 * a no-op.
 */
export const commandTriggerProvenance: Migration = {
  id: 18,
  name: "command-trigger-provenance",
  up(db: DatabaseType): void {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(command_records)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );

    // Guarded individually rather than as a batch, matching 017: a database
    // part-way through a failed earlier attempt must be able to complete rather
    // than trip over the first column that already exists.
    const add = (column: string, ddl: string): void => {
      if (!columns.has(column)) {
        db.exec(`ALTER TABLE command_records ADD COLUMN ${column} ${ddl};`);
      }
    };

    /** Class of the triggering originator, from EventMetadata.source.kind. */
    add("trigger_kind", "TEXT DEFAULT NULL");
    /** The specific originator within that class, from EventMetadata.source.id. */
    add("trigger_id", "TEXT DEFAULT NULL");
    /** Subject the rule fired on, from EventContext.topic. The dependable one. */
    add("trigger_topic", "TEXT DEFAULT NULL");

    // No index is added. Grouping queries `execution_id = ? AND rule_id = ?` ordered
    // by `requested_at`, which the baseline's `idx_command_records_execution` on
    // (execution_id, requested_at DESC) already covers: the leading column narrows to
    // one execution and supplies the ordering, leaving rule_id as a filter over the
    // handful of rows that remain. A second index on (execution_id, rule_id) would be
    // redundant, and under the same name would silently do nothing at all.
  },
};
