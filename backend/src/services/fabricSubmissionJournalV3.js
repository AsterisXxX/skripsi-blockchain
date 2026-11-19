/**
 * NexusMed M15 - candidate pre-submit Fabric journal.
 *
 * Requires a caller-supplied SQLite connection whose
 * schema has already been provisioned.
 *
 * No Fabric calls, network access, migrations, or
 * automatic retry/commit authorization.
 *
 * A persisted TxID represents an attempt prepared
 * for submission, NOT a committed Fabric transaction.
 */

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const TXID = /^[a-f0-9]{64}$/;

export function prepareFabricSubmissionV3(db, input = {}) {
  const {
    referralId,
    transactionId,
    documentHash,
    timestamp,
  } = input;

  if (
    typeof referralId !== "string" ||
    !ID.test(referralId) ||
    typeof transactionId !== "string" ||
    !TXID.test(transactionId) ||
    typeof documentHash !== "string" ||
    !HASH.test(documentHash) ||
    typeof timestamp !== "string" ||
    !Number.isFinite(Date.parse(timestamp)) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(timestamp)
  ) {
    throw new Error("INVALID_FABRIC_SUBMISSION_METADATA");
  }

  return db.transaction(() => {
    const referral = db.prepare(`
      SELECT referral_id, document_hash, status
      FROM referral_registry
      WHERE referral_id = ?
    `).get(referralId);

    if (!referral) {
      throw new Error("REFERRAL_NOT_FOUND");
    }

    if (referral.status !== "pending_ledger") {
      throw new Error("REFERRAL_NOT_PENDING_LEDGER");
    }

    if (referral.document_hash !== documentHash) {
      throw new Error("REFERRAL_DOCUMENT_HASH_MISMATCH");
    }

    const result = db.prepare(`
      INSERT INTO fabric_submission_journal_v3 (
        referral_id,
        transaction_id,
        document_hash,
        submission_timestamp,
        status
      ) VALUES (?, ?, ?, ?, 'prepared')
    `).run(
      referralId,
      transactionId,
      documentHash,
      timestamp
    );

    if (result.changes !== 1) {
      throw new Error("JOURNAL_INSERT_FAILED");
    }

    return Object.freeze({
      referralId,
      transactionId,
      status: "prepared",
      allowRegistryCommit: false,
      allowFabricRetry: false,
    });
  }).immediate();
}

export function findFabricSubmissionV3(db, referralId) {
  if (typeof referralId !== "string" || !ID.test(referralId)) {
    throw new Error("INVALID_REFERRAL_ID");
  }

  const record = db.prepare(`
    SELECT
      referral_id,
      transaction_id,
      document_hash,
      submission_timestamp,
      status
    FROM fabric_submission_journal_v3
    WHERE referral_id = ?
  `).get(referralId);

  return record || null;
}
