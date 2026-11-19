import {
  assertNewReferralVersion,
} from "./referralEnvelopePolicy.js";

import {
  calculateReferralDocumentHash,
} from "./versionedReferralIntegrity.js";

import {
  verifyNewReferralReceiverKey,
} from "./trustedReceiverKey.js";

const HASH = /^[a-f0-9]{64}$/;

/**
 * Preflight validation for NEW referral submissions.
 *
 * No storage writes, Fabric submissions, or DB mutations.
 * DB is injected and must be owned by the trusted backend.
 */
export function validateNewReferralPreflight({
  db,
  payload,
  receiverInstitutionId,
  env,
}) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("INVALID_REFERRAL_PAYLOAD");
  }

  // Explicit mode resolution; invalid configuration fails closed.
  const policy = assertNewReferralVersion(payload, env);

  // Validate supplied hash before comparing it.
  if (
    typeof payload.documentHash !== "string" ||
    !HASH.test(payload.documentHash)
  ) {
    throw new Error("INVALID_REFERRAL_DOCUMENT_HASH");
  }

  // Version-specific hash calculation.
  const calculatedHash =
    calculateReferralDocumentHash(payload);

  if (calculatedHash !== payload.documentHash) {
    throw new Error("REFERRAL_DOCUMENT_HASH_MISMATCH");
  }

  let receiverKey = null;

  if (policy.version === 2) {
    if (!db || typeof db.prepare !== "function") {
      throw new Error("TRUSTED_REGISTRY_DATABASE_UNAVAILABLE");
    }

    // documentHash is excluded from the canonical v2 envelope.
    // It was already verified against the complete payload above.
    const { documentHash: _documentHash, ...envelope } = payload;

    receiverKey = verifyNewReferralReceiverKey(
      db,
      envelope,
      receiverInstitutionId
    );
  }

  return {
    mode: policy.mode,
    version: policy.version,
    documentHash: calculatedHash,
    receiverKey,
  };
}
