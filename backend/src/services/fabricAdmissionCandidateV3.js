/**
 * M15 offline durable admission candidate.
 * No production wiring or automatic migration.
 *
 * Migration only works on caller-supplied SQLite.
 * Historical records are NEVER backfilled.
 */

import {
  claimTxIdOwnershipCandidateV3,
} from "./fabricSubmissionOwnershipTxIdCandidateV3.js";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;

export function migrateAdmissionCandidateV3(db) {
  return db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS
        fabric_submission_admission_candidate_v3 (
          referral_id TEXT PRIMARY KEY
            REFERENCES referral_registry(referral_id),

          document_hash TEXT NOT NULL
            CHECK (
              length(document_hash) = 64
              AND document_hash NOT GLOB '*[^0-9a-f]*'
            ),

          admitted_at TEXT NOT NULL
            DEFAULT CURRENT_TIMESTAMP
        );

      CREATE TRIGGER IF NOT EXISTS
        trg_admission_candidate_no_update
      BEFORE UPDATE
      ON fabric_submission_admission_candidate_v3
      BEGIN
        SELECT RAISE(ABORT, 'Admission immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS
        trg_admission_candidate_no_delete
      BEFORE DELETE
      ON fabric_submission_admission_candidate_v3
      BEGIN
        SELECT RAISE(ABORT, 'Admission undeletable');
      END;
    `);
  }).immediate();
}

/**
 * Synthetic intent enrollment only.
 *
 * Must insert registry and admission atomically.
 * Not intended for backfilling existing referrals.
 */
export function createAdmittedIntentCandidateV3(
  db,
  { referralId, documentHash } = {}
) {
  if (!ID.test(referralId || "") ||
      !HASH.test(documentHash || "")) {
    throw new Error("ADMISSION_INVALID_INPUT");
  }

  return db.transaction(() => {
    db.prepare(`
      INSERT INTO referral_registry
        (referral_id, document_hash, status)
      VALUES (?, ?, 'pending_storage')
    `).run(referralId, documentHash);

    db.prepare(`
      INSERT INTO fabric_submission_admission_candidate_v3
        (referral_id, document_hash)
      VALUES (?, ?)
    `).run(referralId, documentHash);

    return Object.freeze({
      referralId,
      admitted: true,
    });
  }).immediate();
}

/**
 * Admission and ownership checked in the same
 * SQLite writer transaction.
 *
 * Admission alone never authorizes submission.
 */
export function claimAdmittedSubmissionCandidateV3(
  db,
  input = {}
) {
  return db.transaction(() => {
    const admission = db.prepare(`
      SELECT a.document_hash
      FROM fabric_submission_admission_candidate_v3 a
      JOIN referral_registry r
        ON r.referral_id = a.referral_id
      WHERE a.referral_id = ?
        AND a.document_hash = r.document_hash
        AND r.status = 'pending_ledger'
    `).get(input.referralId);

    if (
      !admission ||
      admission.document_hash !== input.documentHash
    ) {
      throw new Error(
        "ADMISSION_MISSING_REQUIRES_RECONCILIATION"
      );
    }

    return claimTxIdOwnershipCandidateV3(db, input);
  }).immediate();
}
