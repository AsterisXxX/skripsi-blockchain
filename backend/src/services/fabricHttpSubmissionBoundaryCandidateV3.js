/**
 * M15 offline HTTP submission boundary candidate.
 *
 * Caller injects SQLite and Fabric contract.
 * No SDK imports, network calls, migration,
 * automatic retry or registry commit.
 *
 * NOT wired to the production HTTP route.
 */

import {
  coordinateFabricSubmissionCandidateV3,
} from "./fabricSubmissionCoordinatorCandidateV3.js";

export async function executeHttpSubmissionBoundaryCandidateV3({
  db,
  contract,
  referralId,
  patientId,
  receiverId = "Org2MSP",
  documentHash,
  timestamp,
  storageConfirmed = false,
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    return Object.freeze({
      code: 503,
      body: {
        status: "unavailable",
        reason: "SUBMISSION_DATABASE_UNAVAILABLE",
      },
    });
  }

  // Fail closed if the required admission and ownership
  // schema has not been explicitly provisioned.
  const required = [
    "referral_registry",
    "fabric_submission_admission_candidate_v3",
    "fabric_submission_ownership_txid_candidate_v3",
  ];

  try {
    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all();

    const existing = new Set(tables.map(row => row.name));

    if (required.some(name => !existing.has(name))) {
      return Object.freeze({
        code: 503,
        body: {
          status: "unavailable",
          reason: "SUBMISSION_SCHEMA_NOT_READY",
        },
      });
    }
  } catch {
    return Object.freeze({
      code: 503,
      body: {
        status: "unavailable",
        reason: "SUBMISSION_SCHEMA_CHECK_FAILED",
      },
    });
  }

  if (storageConfirmed !== true) {
    return Object.freeze({
      code: 202,
      body: {
        status: "pending_storage",
        allowFabricRetry: false,
        allowRegistryCommit: false,
      },
    });
  }

  try {
    const result = await coordinateFabricSubmissionCandidateV3({
      db,
      contract,
      owner: "legacy",
      referralId,
      patientId,
      receiverId,
      documentHash,
      timestamp,
      storageConfirmed: true,
    });

    if (
      result.status !== "pending_evidence" ||
      result.allowRegistryCommit !== false ||
      result.allowFabricRetry !== false
    ) {
      throw new Error("UNSAFE_COORDINATOR_RESULT");
    }

    return Object.freeze({
      code: 202,
      body: {
        status: "pending_evidence",
        referralId,
        allowFabricRetry: false,
        allowRegistryCommit: false,
      },
    });
  } catch {
    // No automatic retry and no registry commit.
    // A durable claim may already exist.
    return Object.freeze({
      code: 202,
      body: {
        status: "pending_review",
        referralId,
        allowFabricRetry: false,
        allowRegistryCommit: false,
      },
    });
  }
}
