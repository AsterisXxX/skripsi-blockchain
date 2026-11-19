import { createHash } from "node:crypto";

import {
  calculateEnvelopeV2Hash,
  validateEnvelopeV2Point,
} from "./envelopeIntegrity.js";

const HASH = /^[a-f0-9]{64}$/;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const V2_FIELDS = [
  "version",
  "algorithm",
  "receiverKey",
  "ciphertext",
  "iv",
  "wrappedKey",
  "wrapIv",
  "salt",
  "ephemeralPublicKey",
];

function decodeV1Ciphertext(value) {
  if (
    typeof value !== "string" ||
    !value ||
    !BASE64.test(value)
  ) {
    throw new Error("Invalid v1 ciphertext Base64");
  }

  const bytes = Buffer.from(value, "base64");

  if (
    bytes.length === 0 ||
    bytes.toString("base64") !== value
  ) {
    throw new Error("Invalid v1 ciphertext Base64");
  }

  return bytes;
}

function v2Content(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid referral envelope");
  }

  const keys = Object.keys(payload);

  if (
    keys.length !== V2_FIELDS.length + 1 ||
    !keys.includes("documentHash") ||
    keys.some(
      key =>
        key !== "documentHash" &&
        !V2_FIELDS.includes(key)
    )
  ) {
    throw new Error("Invalid v2 envelope fields");
  }

  const { documentHash, ...content } = payload;

  return content;
}

/**
 * Calculate the document hash for a complete referral envelope.
 *
 * v1: SHA-256(ciphertext bytes)
 * v2: SHA-256(canonical envelope, excluding documentHash)
 *
 * This function does not access the registry.
 */
export function calculateReferralDocumentHash(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid referral envelope");
  }

  if (payload.version === 1) {
    return createHash("sha256")
      .update(decodeV1Ciphertext(payload.ciphertext))
      .digest("hex");
  }

  if (payload.version === 2) {
    return calculateEnvelopeV2Hash(
      v2Content(payload)
    );
  }

  throw new Error("Unsupported referral envelope version");
}

/**
 * Verify an envelope against its own declared hash and
 * an independently trusted hash (SQLite / Fabric).
 *
 * This is not an authorization or E2EE decryptability check.
 */
export function verifyReferralDocumentHash(
  payload,
  expectedHash
) {
  if (
    typeof expectedHash !== "string" ||
    !HASH.test(expectedHash) ||
    typeof payload?.documentHash !== "string" ||
    !HASH.test(payload.documentHash)
  ) {
    throw new Error("Invalid referral document hash");
  }

  const calculatedHash =
    calculateReferralDocumentHash(payload);

  if (
    calculatedHash !== expectedHash ||
    calculatedHash !== payload.documentHash
  ) {
    throw new Error("Referral document hash mismatch");
  }

  if (payload.version === 2) {
    validateEnvelopeV2Point(v2Content(payload));
  }

  return {
    version: payload.version,
    calculatedHash,
    verified: true,
  };
}
