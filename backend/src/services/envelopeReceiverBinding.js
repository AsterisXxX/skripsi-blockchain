import { canonicalEnvelopeV2 } from "./envelopeIntegrity.js";

/**
 * Verify receiver identity against a trusted registry row.
 *
 * Intended for NEW referral ingestion only.
 * Historical retired-key verification needs a separate policy.
 *
 * registryRecord must come from a server-side database query.
 */
export function validateReceiverKeyBinding(
  payload,
  registryRecord,
  expectedReceiverInstitutionId
) {
  // Validate the complete v2 envelope structure first.
  canonicalEnvelopeV2(payload);

  const claimed = payload.receiverKey;
  const registered = registryRecord;

  if (
    typeof expectedReceiverInstitutionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(expectedReceiverInstitutionId)
  ) {
    throw new Error("Invalid expected receiver institution");
  }

  if (
    !registered ||
    typeof registered !== "object" ||
    Array.isArray(registered)
  ) {
    throw new Error("Receiver registry record unavailable");
  }

  if (
    registered.institution_id !== expectedReceiverInstitutionId ||
    claimed.institutionId !== expectedReceiverInstitutionId
  ) {
    throw new Error("Receiver institution mismatch");
  }

  if (
    registered.status !== "active" ||
    registered.retired_at !== null
  ) {
    throw new Error("Receiver registry key is not active");
  }

  if (
    registered.key_id !== claimed.keyId ||
    registered.version !== claimed.version ||
    registered.fingerprint !== claimed.fingerprint
  ) {
    throw new Error("Receiver key identity mismatch");
  }

  return {
    institutionId: registered.institution_id,
    keyId: registered.key_id,
    version: registered.version,
    fingerprint: registered.fingerprint,
  };
}
