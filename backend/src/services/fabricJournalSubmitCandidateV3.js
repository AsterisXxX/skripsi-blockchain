/**
 * NexusMed M15 - offline candidate only.
 *
 * No Gateway connection or production route wiring.
 * Caller must supply an existing database and contract.
 *
 * This module never authorizes registry commit or retry.
 */

import {
  evaluateFabricJournalPolicyV3,
} from "./fabricJournalIntegrationPolicyV3.js";

import {
  prepareFabricSubmissionV3,
  findFabricSubmissionV3,
} from "./fabricSubmissionJournalV3.js";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;

export async function submitPreparedReferralCandidateV3({
  db,
  contract,
  mode = "disabled",
  storageConfirmed = false,
  referralId,
  patientId,
  receiverId = "Org2MSP",
  documentHash,
  timestamp,
} = {}) {
  if (mode !== "prepare_only") {
    // This candidate must never silently fall back
    // to legacy submission.
    throw new Error("JOURNAL_CANDIDATE_NOT_ENABLED");
  }

  if (
    !db ||
    typeof db.prepare !== "function" ||
    !contract ||
    typeof contract.createTransaction !== "function" ||
    typeof referralId !== "string" ||
    !ID.test(referralId) ||
    typeof patientId !== "string" ||
    patientId.length === 0 ||
    receiverId !== "Org2MSP" ||
    !HASH.test(documentHash || "")
  ) {
    throw new Error("JOURNAL_CANDIDATE_INVALID_INPUT");
  }

  if (storageConfirmed !== true) {
    throw new Error("JOURNAL_CANDIDATE_STORAGE_UNCONFIRMED");
  }

  const registry = db.prepare(`
    SELECT referral_id, document_hash, status
    FROM referral_registry
    WHERE referral_id = ?
  `).get(referralId);

  if (
    !registry ||
    registry.status !== "pending_ledger" ||
    registry.document_hash !== documentHash
  ) {
    throw new Error("JOURNAL_CANDIDATE_REGISTRY_NOT_READY");
  }

  // A previous prepared attempt must never cause
  // the creation of a second SDK transaction.
  const existing = findFabricSubmissionV3(db, referralId);

  if (existing) {
    throw new Error("JOURNAL_CANDIDATE_EXISTING_ATTEMPT");
  }

  const transaction = contract.createTransaction(
    "CreateReferral"
  );

  if (
    !transaction ||
    typeof transaction.getTransactionId !== "function" ||
    typeof transaction.setEndorsingOrganizations !== "function" ||
    typeof transaction.submit !== "function"
  ) {
    throw new Error("JOURNAL_CANDIDATE_INVALID_TRANSACTION");
  }

  transaction.setEndorsingOrganizations(
    "Org1MSP",
    "Org2MSP"
  );

  const transactionId = transaction.getTransactionId();

  evaluateFabricJournalPolicyV3({
    mode,
    referralId,
    transactionId,
    documentHash,
    timestamp,
    registry,
    storageConfirmed,
  });

  // Synchronous durable journal preparation.
  // If this throws, transaction.submit() is never called.
  const journal = prepareFabricSubmissionV3(db, {
    referralId,
    transactionId,
    documentHash,
    timestamp,
  });

  if (
    journal.status !== "prepared" ||
    journal.transactionId !== transactionId
  ) {
    throw new Error("JOURNAL_CANDIDATE_PREPARATION_MISMATCH");
  }

  try {
    await transaction.submit(
      referralId,
      patientId,
      receiverId,
      documentHash,
      timestamp
    );
  } catch {
    // Do not leak SDK error objects, which may
    // contain arguments or patient identifiers.
    // Journal remains prepared; never auto-retry.
    throw new Error("FABRIC_SUBMISSION_UNCONFIRMED");
  }

  return Object.freeze({
    referralId,
    transactionId,
    status: "pending_evidence",
    allowRegistryCommit: false,
    allowFabricRetry: false,
  });
}
