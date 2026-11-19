/**
 * M15 offline TxID ownership candidate.
 * No production wiring or automatic migration.
 */

import {
  prepareFabricSubmissionV3,
  findFabricSubmissionV3,
} from "./fabricSubmissionJournalV3.js";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HEX = /^[a-f0-9]{64}$/;

export function migrateTxIdOwnershipCandidateV3(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS
        fabric_submission_ownership_txid_candidate_v3 (
          referral_id TEXT PRIMARY KEY
            REFERENCES referral_registry(referral_id),

          document_hash TEXT NOT NULL
            CHECK (
              length(document_hash) = 64
              AND document_hash NOT GLOB '*[^0-9a-f]*'
            ),

          owner TEXT NOT NULL
            CHECK (owner IN ('legacy', 'journal')),

          transaction_id TEXT NOT NULL UNIQUE
            CHECK (
              length(transaction_id) = 64
              AND transaction_id NOT GLOB '*[^0-9a-f]*'
            ),

          claimed_at TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP
        );

      CREATE TRIGGER IF NOT EXISTS
        trg_ownership_txid_candidate_no_update
      BEFORE UPDATE
      ON fabric_submission_ownership_txid_candidate_v3
      BEGIN
        SELECT RAISE(ABORT, 'Ownership immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS
        trg_ownership_txid_candidate_no_delete
      BEFORE DELETE
      ON fabric_submission_ownership_txid_candidate_v3
      BEGIN
        SELECT RAISE(ABORT, 'Ownership undeletable');
      END;
    `);
  }).immediate();
}

export function claimTxIdOwnershipCandidateV3(db, input = {}) {
  const {
    referralId,
    documentHash,
    owner,
    transactionId,
    timestamp,
  } = input;

  if (
    !ID.test(referralId || "") ||
    !HEX.test(documentHash || "") ||
    !HEX.test(transactionId || "") ||
    !["legacy", "journal"].includes(owner) ||
    typeof timestamp !== "string" ||
    !Number.isFinite(Date.parse(timestamp)) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(timestamp)
  ) {
    throw new Error("OWNERSHIP_TXID_INVALID_INPUT");
  }

  return db.transaction(() => {
    const registry = db.prepare(`
      SELECT document_hash, status
      FROM referral_registry
      WHERE referral_id = ?
    `).get(referralId);

    if (
      !registry ||
      registry.status !== "pending_ledger" ||
      registry.document_hash !== documentHash
    ) {
      throw new Error("OWNERSHIP_TXID_REGISTRY_NOT_READY");
    }

    if (findFabricSubmissionV3(db, referralId)) {
      throw new Error("OWNERSHIP_TXID_EXISTING_JOURNAL");
    }

    db.prepare(`
      INSERT INTO fabric_submission_ownership_txid_candidate_v3
        (referral_id, document_hash, owner, transaction_id)
      VALUES (?, ?, ?, ?)
    `).run(
      referralId,
      documentHash,
      owner,
      transactionId
    );

    if (owner === "journal") {
      prepareFabricSubmissionV3(db, {
        referralId,
        documentHash,
        transactionId,
        timestamp,
      });
    }

    return Object.freeze({
      referralId,
      owner,
      transactionId,
      status: "claimed",
      allowFabricRetry: false,
      allowRegistryCommit: false,
    });
  }).immediate();
}
