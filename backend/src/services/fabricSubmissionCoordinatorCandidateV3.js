/**
 * M15 isolated unified submission coordinator candidate.
 *
 * No production wiring, SDK imports, Gateway factory,
 * automatic migration, retry, or registry commit.
 *
 * The caller supplies an isolated database and contract.
 */

import {
  claimAdmittedSubmissionCandidateV3,
} from "./fabricAdmissionCandidateV3.js";

const OWNERS = new Set(["legacy", "journal"]);

export async function coordinateFabricSubmissionCandidateV3({
  db,
  contract,
  owner,
  referralId,
  patientId,
  receiverId = "Org2MSP",
  documentHash,
  timestamp,
  storageConfirmed = false,
} = {}) {
  if (
    !db ||
    typeof db.prepare !== "function" ||
    !contract ||
    typeof contract.createTransaction !== "function" ||
    !OWNERS.has(owner) ||
    typeof patientId !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(patientId) ||
    receiverId !== "Org2MSP" ||
    storageConfirmed !== true
  ) {
    throw new Error("COORDINATOR_PRECONDITION_FAILED");
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
    throw new Error("COORDINATOR_INVALID_TRANSACTION");
  }

  transaction.setEndorsingOrganizations(
    "Org1MSP",
    "Org2MSP"
  );

  const transactionId = transaction.getTransactionId();

  // Mandatory durable preparation before submission.
  // Claim failure must propagate without submitting.
  const claim = claimAdmittedSubmissionCandidateV3(db, {
    referralId,
    documentHash,
    owner,
    transactionId,
    timestamp,
  });

  if (
    claim.status !== "claimed" ||
    claim.transactionId !== transactionId
  ) {
    throw new Error("COORDINATOR_CLAIM_MISMATCH");
  }

  // No SQLite transaction spans the external operation.
  try {
    await transaction.submit(
      referralId,
      patientId,
      receiverId,
      documentHash,
      timestamp
    );
  } catch {
    // The submission may have reached Fabric.
    // The durable claim remains unchanged.
    throw new Error("COORDINATOR_SUBMISSION_UNCONFIRMED");
  }

  return Object.freeze({
    referralId,
    transactionId,
    owner,
    status: "pending_evidence",
    allowFabricRetry: false,
    allowRegistryCommit: false,
  });
}
