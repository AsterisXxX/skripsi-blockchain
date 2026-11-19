/**
 * M15 offline real-registry admission integration.
 *
 * No route wiring, automatic migration or backfill.
 * Calls the existing production registry service.
 */

import {
  createReferralIntent,
} from "./referralRegistryService.js";

export function createAdmittedRegistryIntentCandidateV3(
  db,
  input
) {
  if (
    !db ||
    typeof db.transaction !== "function" ||
    typeof db.prepare !== "function" ||
    !input ||
    typeof input !== "object"
  ) {
    throw new Error("REGISTRY_ADMISSION_INVALID_INPUT");
  }

  return db.transaction(() => {
    // Existing production validation and INSERT.
    // Its nested better-sqlite3 transaction is a
    // savepoint inside this outer transaction.
    const registry = createReferralIntent(db, input);

    // Only reached after a NEW registry INSERT.
    // Existing historical IDs cannot be enrolled
    // through this function.
    const result = db.prepare(`
      INSERT INTO fabric_submission_admission_candidate_v3
        (referral_id, document_hash)
      VALUES (?, ?)
    `).run(
      registry.referralId,
      registry.documentHash
    );

    if (result.changes !== 1) {
      throw new Error("REGISTRY_ADMISSION_INSERT_FAILED");
    }

    return Object.freeze({
      ...registry,
      admitted: true,
    });
  }).immediate();
}
