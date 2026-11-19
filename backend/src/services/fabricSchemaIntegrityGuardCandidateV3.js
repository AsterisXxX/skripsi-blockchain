/**
 * M15 OFFLINE candidate schema integrity preflight.
 * Read-only metadata inspection on caller-supplied SQLite.
 * No migration, external I/O, or schema repair.
 */

const TABLES = [
  "fabric_submission_admission_candidate_v3",
  "fabric_submission_ownership_txid_candidate_v3",
  "fabric_submission_journal_v3",
];

const TRIGGERS = [
  ["trg_admission_candidate_no_update", TABLES[0], "UPDATE"],
  ["trg_admission_candidate_no_delete", TABLES[0], "DELETE"],
  ["trg_ownership_txid_candidate_no_update", TABLES[1], "UPDATE"],
  ["trg_ownership_txid_candidate_no_delete", TABLES[1], "DELETE"],
  ["trg_fabric_journal_v3_no_update", TABLES[2], "UPDATE"],
  ["trg_fabric_journal_v3_no_delete", TABLES[2], "DELETE"],
];

function reject() {
  throw new Error("M15_SCHEMA_INTEGRITY_FAILED");
}

// M15_CANONICAL_FULL_TABLE_DDL_V3
// Reviewed M15 table definitions, pinned at build time.
// Do not derive these values from the runtime database.
const EXPECTED_TABLE_DDL_V3 = Object.freeze({
  "fabric_submission_admission_candidate_v3": "CREATETABLEFABRIC_SUBMISSION_ADMISSION_CANDIDATE_V3(REFERRAL_IDTEXTPRIMARYKEYREFERENCESREFERRAL_REGISTRY(REFERRAL_ID),DOCUMENT_HASHTEXTNOTNULLCHECK(LENGTH(DOCUMENT_HASH)=64ANDDOCUMENT_HASHNOTGLOB'*[^0-9A-F]*'),ADMITTED_ATTEXTNOTNULLDEFAULTCURRENT_TIMESTAMP)",
  "fabric_submission_ownership_txid_candidate_v3": "CREATETABLEFABRIC_SUBMISSION_OWNERSHIP_TXID_CANDIDATE_V3(REFERRAL_IDTEXTPRIMARYKEYREFERENCESREFERRAL_REGISTRY(REFERRAL_ID),DOCUMENT_HASHTEXTNOTNULLCHECK(LENGTH(DOCUMENT_HASH)=64ANDDOCUMENT_HASHNOTGLOB'*[^0-9A-F]*'),OWNERTEXTNOTNULLCHECK(OWNERIN('LEGACY','JOURNAL')),TRANSACTION_IDTEXTNOTNULLUNIQUECHECK(LENGTH(TRANSACTION_ID)=64ANDTRANSACTION_IDNOTGLOB'*[^0-9A-F]*'),CLAIMED_ATTEXTNOTNULLDEFAULTCURRENT_TIMESTAMP)",
  "fabric_submission_journal_v3": "CREATETABLEFABRIC_SUBMISSION_JOURNAL_V3(REFERRAL_IDTEXTPRIMARYKEY,TRANSACTION_IDTEXTNOTNULLUNIQUECHECK(LENGTH(TRANSACTION_ID)=64ANDTRANSACTION_IDNOTGLOB'*[^0-9A-F]*'),DOCUMENT_HASHTEXTNOTNULLCHECK(LENGTH(DOCUMENT_HASH)=64ANDDOCUMENT_HASHNOTGLOB'*[^0-9A-F]*'),SUBMISSION_TIMESTAMPTEXTNOTNULLCHECK(LENGTH(SUBMISSION_TIMESTAMP)BETWEEN20AND40),STATUSTEXTNOTNULLDEFAULT'PREPARED'CHECK(STATUS='PREPARED'),CREATED_ATTEXTNOTNULLDEFAULTCURRENT_TIMESTAMP,FOREIGNKEY(REFERRAL_ID)REFERENCESREFERRAL_REGISTRY(REFERRAL_ID))",
});

function canonicalTableSql(sql) {
  if (typeof sql !== "string") reject();
  return sql.replace(/\s+/g, "").toUpperCase();
}

function requireTable(db, name) {
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(name);

  if (!row?.sql) reject();

  // M15_REJECT_SQL_DDL_COMMENTS_V3
  //
  // sqlite_master preserves SQL comments.
  // Textual CHECK inspection could mistake
  // a commented-out CHECK for a real constraint.
  //
  // The reviewed M15 table migrations do not
  // use SQL comments inside CREATE TABLE.
  // Fail closed on any comment delimiter.
  if (/\/\*|--/.test(row.sql)) reject();

  if (
    canonicalTableSql(row.sql) !==
    EXPECTED_TABLE_DDL_V3[name]
  ) reject();

}

// M15_CANONICAL_TRIGGER_DEFINITIONS_V3
//
// Trusted baseline taken from the reviewed
// M15 offline migration candidates.
//
// Whitespace/case normalization is used only
// for SQL metadata comparison. No SQL is executed.
const TRIGGER_ABORT_MESSAGES = Object.freeze({
  trg_admission_candidate_no_update:
    "Admission immutable",

  trg_admission_candidate_no_delete:
    "Admission undeletable",

  trg_ownership_txid_candidate_no_update:
    "Ownership immutable",

  trg_ownership_txid_candidate_no_delete:
    "Ownership undeletable",

  trg_fabric_journal_v3_no_update:
    "Fabric submission journal is immutable",

  trg_fabric_journal_v3_no_delete:
    "Fabric submission journal cannot be deleted",
});

function canonicalTriggerSql(sql) {
  if (typeof sql !== "string") reject();

  return sql
    .replace(/\s+/g, "")
    .toUpperCase();
}

function requireTrigger(db, name, table, event) {
  const row = db.prepare(`
    SELECT tbl_name, sql
    FROM sqlite_master
    WHERE type = 'trigger' AND name = ?
  `).get(name);

  if (
    !row ||
    row.tbl_name !== table ||
    !row.sql
  ) {
    reject();
  }

  const message = TRIGGER_ABORT_MESSAGES[name];

  if (!message || !["UPDATE", "DELETE"].includes(event)) {
    reject();
  }

  const expectedSql = `
    CREATE TRIGGER ${name}
    BEFORE ${event}
    ON ${table}
    BEGIN
      SELECT RAISE(ABORT, '${message}');
    END
  `;

  if (
    canonicalTriggerSql(row.sql) !==
    canonicalTriggerSql(expectedSql)
  ) {
    reject();
  }
}

// M15_ADMISSION_HASH_CHECK_INTEGRITY_V3
//
// Read-only inspection of the admission CHECK
// expression from the reviewed M15 migration.
//
// This is a targeted check; it is NOT a complete
// canonical table-definition verifier.
function requireAdmissionHashCheck(db) {
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(TABLES[0]);

  if (!row?.sql) reject();

  const actual = row.sql
    .replace(/\s+/g, "")
    .toUpperCase();

  const expected =
    "CHECK(" +
    "LENGTH(DOCUMENT_HASH)=64" +
    "ANDDOCUMENT_HASHNOTGLOB" +
    "'*[^0-9A-F]*'" +
    ")";

  // Demand the exact expression produced by
  // the current admission migration.
  // This rejects weakened comparison operators,
  // altered hash length, or changed GLOB patterns.
  const occurrences = actual.split(expected).length - 1;

  if (occurrences !== 1) reject();

  // A malformed or duplicate CHECK clause should
  // not be silently accepted by this targeted guard.
  const checkCount =
    (actual.match(/CHECK\(/g) || []).length;

  if (checkCount !== 1) reject();
}

// M15_OWNERSHIP_OWNER_CHECK_INTEGRITY_V3
//
// Targeted verification of the owner-domain CHECK
// from the reviewed ownership migration.
//
// Other ownership CHECK expressions still require
// independent verification.
function requireOwnershipOwnerCheck(db) {
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(TABLES[1]);

  if (!row?.sql) reject();

  const normalized = row.sql
    .replace(/\s+/g, "")
    .toUpperCase();

  const expected =
    "CHECK(OWNERIN('LEGACY','JOURNAL'))";

  const occurrences =
    normalized.split(expected).length - 1;

  if (occurrences !== 1) reject();

  // M15_OWNERSHIP_HASH_CHECK_INTEGRITY_V3
  //
  // Require the exact hash-domain CHECK expression
  // generated by the reviewed ownership migration.
  // The separate owner-domain check stays active.
  const expectedHashCheck =
    "CHECK(" +
    "LENGTH(DOCUMENT_HASH)=64" +
    "ANDDOCUMENT_HASHNOTGLOB" +
    "'*[^0-9A-F]*'" +
    ")";

  const hashCheckOccurrences =
    normalized.split(expectedHashCheck).length - 1;

  if (hashCheckOccurrences !== 1) reject();

  // M15_OWNERSHIP_TXID_CHECK_INTEGRITY_V3
  //
  // Require the exact reviewed ownership TxID
  // domain expression, independently from UNIQUE.
  const expectedTxIdCheck =
    "CHECK(" +
    "LENGTH(TRANSACTION_ID)=64" +
    "ANDTRANSACTION_IDNOTGLOB" +
    "'*[^0-9A-F]*'" +
    ")";

  const txIdCheckOccurrences =
    normalized.split(expectedTxIdCheck).length - 1;

  if (txIdCheckOccurrences !== 1) reject();

  // Reviewed ownership migration has exactly:
  // document_hash, owner, transaction_id CHECKs.
  const totalChecks =
    (normalized.match(/CHECK\(/g) || []).length;

  if (totalChecks !== 3) reject();
}

// M15_JOURNAL_TXID_CHECK_INTEGRITY_V3
//
// Targeted metadata verification against the
// reviewed journal migration's TxID CHECK.
//
// Other journal CHECK expressions are audited
// independently in later steps.
function requireJournalTxIdCheck(db) {
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(TABLES[2]);

  if (!row?.sql) reject();

  const normalized = row.sql
    .replace(/\s+/g, "")
    .toUpperCase();

  const expectedTxIdCheck =
    "CHECK(" +
    "LENGTH(TRANSACTION_ID)=64" +
    "ANDTRANSACTION_IDNOTGLOB" +
    "'*[^0-9A-F]*'" +
    ")";

  const occurrences =
    normalized.split(expectedTxIdCheck).length - 1;

  if (occurrences !== 1) reject();

  // M15_JOURNAL_HASH_CHECK_INTEGRITY_V3
  //
  // Require the canonical document_hash CHECK from
  // the reviewed journal migration.
  //
  // This is independent of journal TxID uniqueness
  // and the journal TxID CHECK.
  const expectedJournalHashCheck =
    "CHECK(" +
    "LENGTH(DOCUMENT_HASH)=64" +
    "ANDDOCUMENT_HASHNOTGLOB" +
    "'*[^0-9A-F]*'" +
    ")";

  const journalHashCheckOccurrences =
    normalized.split(expectedJournalHashCheck).length - 1;

  if (journalHashCheckOccurrences !== 1) reject();

  // M15_JOURNAL_TIMESTAMP_CHECK_INTEGRITY_V3
  //
  // Require the exact reviewed timestamp length
  // expression. This checks DDL integrity, not
  // whether a timestamp is valid ISO 8601.
  const expectedTimestampCheck =
    "CHECK(" +
    "LENGTH(SUBMISSION_TIMESTAMP)BETWEEN20AND40" +
    ")";

  const timestampCheckOccurrences =
    normalized.split(expectedTimestampCheck).length - 1;

  if (timestampCheckOccurrences !== 1) reject();

  // M15_JOURNAL_STATUS_CHECK_INTEGRITY_V3
  //
  // The immutable journal must retain its
  // reviewed prepared-only status constraint.
  const expectedStatusCheck =
    "CHECK(STATUS='PREPARED')";

  const statusCheckOccurrences =
    normalized.split(expectedStatusCheck).length - 1;

  if (statusCheckOccurrences !== 1) reject();

  // The reviewed journal migration declares
  // exactly four CHECK constraints:
  // TxID, document hash, timestamp and status.
  const checkCount =
    (normalized.match(/CHECK\(/g) || []).length;

  if (checkCount !== 4) reject();
}

function requireUniqueColumn(db, table, column) {
  // Identifiers are fixed constants from TABLES,
  // never derived from HTTP request data.
  const indexes = db.prepare(
    `PRAGMA index_list("${table}")`
  ).all();

  const found = indexes.some(index => {
    if (index.unique !== 1 || index.partial === 1) {
      return false;
    }

    const columns = db.prepare(
      `PRAGMA index_info("${index.name.replaceAll('"', '""')}")`
    ).all();

    return columns.length === 1 &&
      columns[0].name === column;
  });

  if (!found) reject();
}

function requireRegistryForeignKey(db, table) {
  const foreignKeys = db.prepare(
    `PRAGMA foreign_key_list("${table}")`
  ).all();

  const found = foreignKeys.some(key =>
    key.table === "referral_registry" &&
    key.from === "referral_id" &&
    key.to === "referral_id"
  );

  if (!found) reject();
}

export function assertFabricSchemaIntegrityCandidateV3(db) {
  if (!db || typeof db.prepare !== "function") {
    reject();
  }

  const fk = db.prepare("PRAGMA foreign_keys").get();

  if (fk?.foreign_keys !== 1) {
    reject();
  }

  for (const table of TABLES) {
    requireTable(db, table);
    requireRegistryForeignKey(db, table);
  }

  requireAdmissionHashCheck(db);
  requireOwnershipOwnerCheck(db);
  requireJournalTxIdCheck(db);

  for (const [name, table, event] of TRIGGERS) {
    requireTrigger(db, name, table, event);
  }

  requireUniqueColumn(
    db,
    TABLES[1],
    "transaction_id"
  );

  requireUniqueColumn(
    db,
    TABLES[2],
    "transaction_id"
  );

  // The existing candidate route separately
  // validates essential table columns.
  return true;
}
