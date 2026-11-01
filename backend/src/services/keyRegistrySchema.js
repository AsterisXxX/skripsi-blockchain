export function assertKeyRegistrySchema(db) {
  const table = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'institution_public_keys'
  `).get();

  if (!table) {
    throw new Error(
      "Public key registry belum dimigrasi. " +
      "Jalankan: node backend/scripts/migrate-public-keys.js"
    );
  }

  const required = [
    "key_id",
    "institution_id",
    "version",
    "public_key_jwk",
    "fingerprint",
    "status",
    "created_at",
    "retired_at"
  ];

  const columns = new Set(
    db.prepare(`
      PRAGMA table_info(institution_public_keys)
    `).all().map(column => column.name)
  );

  const missing = required.filter(
    column => !columns.has(column)
  );

  if (missing.length > 0) {
    throw new Error(
      `Public key registry schema tidak lengkap: ${missing.join(", ")}`
    );
  }

  return true;
}
