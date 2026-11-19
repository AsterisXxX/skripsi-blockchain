/**
 * NexusMed referral envelope version policy.
 *
 * This is an isolated policy module.
 * It is not connected to production routes yet.
 */

const SUPPORTED_VERSIONS = Object.freeze([1, 2]);

export function resolveReferralWriteMode(env = process.env) {
  const mode = env.NEXUSMED_REFERRAL_WRITE_MODE ?? "legacy";

  if (mode !== "legacy" && mode !== "v2_only") {
    throw new Error("INVALID_REFERRAL_WRITE_MODE");
  }

  return mode;
}

/**
 * Applies only to NEW referral submissions.
 *
 * Production default preserves current v1 behavior.
 * v2_only rejects v1 rather than silently downgrading.
 */
export function assertNewReferralVersion(
  payload,
  env = process.env
) {
  const mode = resolveReferralWriteMode(env);

  const version = payload?.version;

  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error("UNSUPPORTED_REFERRAL_ENVELOPE_VERSION");
  }

  if (mode === "legacy" && version !== 1) {
    throw new Error("REFERRAL_V2_NOT_ENABLED");
  }

  if (mode === "v2_only" && version !== 2) {
    throw new Error("LEGACY_REFERRAL_WRITE_DISABLED");
  }

  return {
    mode,
    version,
  };
}

/**
 * Historical reads are independent of the current
 * write policy.
 *
 * This checks version eligibility only. It does NOT
 * verify hashes, RBAC, or cryptographic metadata.
 */
export function assertReadableReferralVersion(payload) {
  const version = payload?.version;

  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error("UNSUPPORTED_REFERRAL_ENVELOPE_VERSION");
  }

  return {
    version,
    readable: true,
  };
}
