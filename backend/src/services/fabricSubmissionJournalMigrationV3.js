/**
 * NexusMed M15: candidate journal migration.
 *
 * Requires an explicitly supplied SQLite connection.
 * Does not open a database, execute on import,
 * or modify existing referral registry tables.
 *
 * Deliberately append-only. Disabling the candidate
 * feature must not erase transaction evidence.
 */

const REQUIRED_COLUMNS = [
  "referral_id",
  "document_hash",
  "status",
  "fabric_transaction_id",
];

export function migrateFabricSubmissionJournalV3(db) {
  if (
    !db ||
    typeof db.prepare !== "function" ||
    typeof db.transaction !== "function"
  ) {
    throw new Error("JOURNAL_MIGRATION_INVALID_DATABASE");
  }

  return db.transaction(() => {
    const columns = new Set(
      db.prepare(
        "PRAGMA table_info(referral_registry)"
      ).all().map(column => column.name)
    );

    if (
      REQUIRED_COLUMNS.some(
        column => !columns.has(column)
      )
    ) {
      throw new Error(
        "JOURNAL_MIGRATION_REGISTRY_SCHEMA_MISMATCH"
      );
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS
        fabric_submission_journal_v3 (
          referral_id TEXT PRIMARY KEY,

          transaction_id TEXT NOT NULL UNIQUE
            CHECK (
              length(transaction_id) = 64
              AND transaction_id
                NOT GLOB '*[^0-9a-f]*'
            ),

          document_hash TEXT NOT NULL
            CHECK (
              length(document_hash) = 64
              AND document_hash
                NOT GLOB '*[^0-9a-f]*'
            ),

          submission_timestamp TEXT NOT NULL
            CHECK (
              length(submission_timestamp) BETWEEN 20 AND 40
            ),

          status TEXT NOT NULL DEFAULT 'prepared'
            CHECK (status = 'prepared'),

          created_at TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (referral_id)
            REFERENCES referral_registry(referral_id)
        );

      CREATE INDEX IF NOT EXISTS
        idx_fabric_submission_journal_txid_v3
      ON fabric_submission_journal_v3(transaction_id);

      CREATE TRIGGER IF NOT EXISTS
        trg_fabric_journal_v3_no_update
      BEFORE UPDATE ON fabric_submission_journal_v3
      BEGIN
        SELECT RAISE(
          ABORT,
          'Fabric submission journal is immutable'
        );
      END;

      CREATE TRIGGER IF NOT EXISTS
        trg_fabric_journal_v3_no_delete
      BEFORE DELETE ON fabric_submission_journal_v3
      BEGIN
        SELECT RAISE(
          ABORT,
          'Fabric submission journal cannot be deleted'
        );
      END;
    `);

    return Object.freeze({
      applied: true,
      destructiveRollbackAllowed: false,
    });
  }).immediate();
}
