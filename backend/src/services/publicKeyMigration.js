export function migratePublicKeyRegistry(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS institution_public_keys (
      key_id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      version INTEGER NOT NULL
        CHECK (version >= 1),
      public_key_jwk TEXT NOT NULL
        CHECK (json_valid(public_key_jwk)),
      fingerprint TEXT NOT NULL UNIQUE
        CHECK (
          length(fingerprint) = 64
          AND fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'retired', 'revoked')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      retired_at TEXT,
      FOREIGN KEY (institution_id)
        REFERENCES institutions(id),
      UNIQUE (institution_id, version)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_institution_active_public_key
    ON institution_public_keys(institution_id)
    WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS
      idx_institution_public_key_history
    ON institution_public_keys(institution_id, version);
  `);

}
