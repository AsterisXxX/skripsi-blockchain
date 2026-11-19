/**
 * M15 candidate: read-only journal schema inspection.
 *
 * Does not migrate, repair, or open any database.
 * Caller supplies the SQLite connection.
 *
 * This is a defensive compatibility check,
 * not a complete security proof of arbitrary SQL.
 */

const TABLE = "fabric_submission_journal_v3";

const REQUIRED_COLUMNS = new Set([
  "referral_id",
  "transaction_id",
  "document_hash",
  "submission_timestamp",
  "status",
  "created_at",
]);

function mismatch() {
  throw new Error("FABRIC_JOURNAL_SCHEMA_DRIFT");
}

export function inspectFabricJournalSchemaV3(db) {
  if (
    !db ||
    typeof db.prepare !== "function"
  ) {
    throw new Error("FABRIC_JOURNAL_SCHEMA_INVALID_DB");
  }

  const table = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(TABLE);

  if (!table) {
    return Object.freeze({
      present: false,
      compatible: false,
    });
  }

  const columns = db.prepare(
    "PRAGMA table_info(fabric_submission_journal_v3)"
  ).all();

  const names = new Set(columns.map(x => x.name));

  if (
    names.size !== REQUIRED_COLUMNS.size ||
    [...REQUIRED_COLUMNS].some(x => !names.has(x))
  ) {
    mismatch();
  }

  const byName = Object.fromEntries(
    columns.map(x => [x.name, x])
  );

  if (
    byName.referral_id.pk !== 1 ||
    !byName.transaction_id.notnull ||
    !byName.document_hash.notnull ||
    !byName.submission_timestamp.notnull ||
    !byName.status.notnull
  ) {
    mismatch();
  }

  const sql = table.sql || "";

  if (
    !/status\s*=\s*'prepared'/i.test(sql) ||
    !/transaction_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sql) ||
    !/length\s*\(\s*transaction_id\s*\)\s*=\s*64/i.test(sql) ||
    !/length\s*\(\s*document_hash\s*\)\s*=\s*64/i.test(sql)
  ) {
    mismatch();
  }

  const foreignKeys = db.prepare(
    "PRAGMA foreign_key_list(fabric_submission_journal_v3)"
  ).all();

  if (!foreignKeys.some(
    x =>
      x.table === "referral_registry" &&
      x.from === "referral_id" &&
      x.to === "referral_id"
  )) {
    mismatch();
  }

  const indexes = db.prepare(
    "PRAGMA index_list(fabric_submission_journal_v3)"
  ).all();

  if (!indexes.some(x => x.unique === 1)) {
    mismatch();
  }

  const triggers = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name = ?
  `).all(TABLE);

  const triggerMap = new Map(
    triggers.map(x => [x.name, x.sql || ""])
  );

  const updateTrigger = triggerMap.get(
    "trg_fabric_journal_v3_no_update"
  );

  const deleteTrigger = triggerMap.get(
    "trg_fabric_journal_v3_no_delete"
  );

  if (
    !updateTrigger ||
    !deleteTrigger ||
    !/BEFORE\s+UPDATE/i.test(updateTrigger) ||
    !/BEFORE\s+DELETE/i.test(deleteTrigger) ||
    !/RAISE\s*\(\s*ABORT/i.test(updateTrigger) ||
    !/RAISE\s*\(\s*ABORT/i.test(deleteTrigger)
  ) {
    mismatch();
  }

  return Object.freeze({
    present: true,
    compatible: true,
  });
}
