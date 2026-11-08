import Database from "better-sqlite3";
import { resolve } from "node:path";

const path = process.argv[2];

if (!path) {
  console.error("Usage: node migrate-referral-registry.mjs <db-path>");
  process.exit(1);
}

const db = new Database(resolve(path), {
  fileMustExist: true,
});

try {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS referral_registry (
        referral_id TEXT PRIMARY KEY
          CHECK (
            length(referral_id) BETWEEN 1 AND 80
            AND referral_id NOT GLOB '*[^A-Za-z0-9_-]*'
          ),

        sender_institution_id TEXT NOT NULL,
        receiver_institution_id TEXT NOT NULL,
        target_department_id TEXT NOT NULL,

        document_hash TEXT NOT NULL
          CHECK (
            length(document_hash) = 64
            AND document_hash NOT GLOB '*[^0-9a-f]*'
          ),

        status TEXT NOT NULL DEFAULT 'pending_storage'
          CHECK (status IN (
            'pending_storage',
            'pending_ledger',
            'committed',
            'failed'
          )),

        fabric_transaction_id TEXT,

        created_at TEXT NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        updated_at TEXT NOT NULL
          DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (sender_institution_id)
          REFERENCES institutions(id),

        FOREIGN KEY (receiver_institution_id)
          REFERENCES institutions(id),

        FOREIGN KEY (
          receiver_institution_id,
          target_department_id
        )
          REFERENCES departments(institution_id, id),

        CHECK (
          sender_institution_id != receiver_institution_id
        ),

        CHECK (
          status != 'committed'
          OR fabric_transaction_id IS NOT NULL
        )
      );

      CREATE INDEX IF NOT EXISTS idx_referral_receiver
      ON referral_registry(
        receiver_institution_id,
        target_department_id,
        status
      );

      CREATE INDEX IF NOT EXISTS idx_referral_sender
      ON referral_registry(
        sender_institution_id,
        created_at
      );

      CREATE TRIGGER IF NOT EXISTS
        trg_referral_immutable_identity
      BEFORE UPDATE OF
        referral_id,
        sender_institution_id,
        receiver_institution_id,
        target_department_id,
        document_hash
      ON referral_registry
      BEGIN
        SELECT RAISE(
          ABORT,
          'Referral identity and hash are immutable'
        );
      END;
    `);
  })();

  const integrity = db.pragma("integrity_check", {
    simple: true,
  });

  if (integrity !== "ok") {
    throw new Error(`Integrity failed: ${integrity}`);
  }

  console.log("PASS: referral_registry schema");
  console.log("PASS: SQLite integrity");
} finally {
  db.close();
}
