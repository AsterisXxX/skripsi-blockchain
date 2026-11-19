/**
 * M15 offline dispatcher candidate.
 *
 * Does not connect to Fabric or invoke the legacy path.
 * A legacy decision is reported, never executed here.
 *
 * Never authorizes retry or registry commit.
 */

import {
  decideFabricJournalPathV3,
} from "./fabricJournalDowngradeGuardV3.js";

import {
  submitPreparedReferralCandidateV3,
} from "./fabricJournalSubmitCandidateV3.js";

export async function dispatchFabricJournalCandidateV3(input = {}) {
  const decision = decideFabricJournalPathV3({
    db: input.db,
    referralId: input.referralId,
    mode: input.mode ?? "disabled",
  });

  if (decision.path === "blocked") {
    return Object.freeze({
      path: "blocked",
      reason: decision.reason,
      allowFabricSubmit: false,
      allowFabricRetry: false,
      allowRegistryCommit: false,
    });
  }

  if (decision.path === "legacy") {
    // Deliberately does not call legacy Fabric service.
    return Object.freeze({
      path: "legacy_selected",
      reason: decision.reason,
      allowFabricSubmit: false,
      allowFabricRetry: false,
      allowRegistryCommit: false,
    });
  }

  if (decision.path !== "journal_candidate") {
    throw new Error("JOURNAL_DISPATCH_INVALID_PATH");
  }

  const result = await submitPreparedReferralCandidateV3({
    ...input,
    mode: "prepare_only",
  });

  return Object.freeze({
    path: "journal_candidate",
    referralId: result.referralId,
    transactionId: result.transactionId,
    status: result.status,
    allowFabricSubmit: false,
    allowFabricRetry: false,
    allowRegistryCommit: false,
  });
}
