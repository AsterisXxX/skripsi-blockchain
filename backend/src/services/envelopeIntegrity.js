import { createHash, createPublicKey } from "node:crypto";

/**
 * NexusMed Envelope v2 integrity contract.
 *
 * Does not modify or replace the v1 ciphertext-hash contract.
 * Only permitted, versioned fields are included.
 */

const ALGORITHM = "AES-256-GCM + ECDH-P256 + HKDF-SHA256";
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const COORD = /^[A-Za-z0-9_-]{43}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Envelope object invalid");
  }

  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key))
  ) {
    throw new Error("Unexpected or missing envelope fields");
  }
}

function base64(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64.test(value)
  ) {
    throw new Error("Invalid canonical Base64");
  }

  try {
    if (btoa(atob(value)) !== value) {
      throw new Error("Noncanonical Base64");
    }
  } catch {
    throw new Error("Invalid canonical Base64");
  }

  return value;
}


const MAX_CIPHERTEXT_BYTES = 2 * 1024 * 1024;

function decodedLength(value, maxBytes) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(maxBytes / 3) * 4
  ) {
    throw new Error("Cryptographic field exceeds size limit");
  }

  // Canonical Base64 must be validated before decoded length.
  base64(value);

  const length = atob(value).length;

  if (length > maxBytes) {
    throw new Error("Cryptographic field exceeds size limit");
  }

  return length;
}

function validateCryptoLengths(payload) {
  const exact = [
    ["iv", 12],
    ["wrapIv", 12],
    ["salt", 16],
    ["wrappedKey", 48],
  ];

  for (const [field, length] of exact) {
    if (decodedLength(payload[field], length) !== length) {
      throw new Error(`Invalid ${field} length`);
    }
  }

  if (
    decodedLength(
      payload.ciphertext,
      MAX_CIPHERTEXT_BYTES
    ) < 17
  ) {
    throw new Error("Invalid ciphertext length");
  }
}

export function canonicalEnvelopeV2(payload) {
  exactKeys(payload, [
    "version", "algorithm", "receiverKey",
    "ciphertext", "iv", "wrappedKey", "wrapIv",
    "salt", "ephemeralPublicKey",
  ]);

  if (payload.version !== 2 || payload.algorithm !== ALGORITHM) {
    throw new Error("Unsupported envelope contract");
  }

  const receiver = payload.receiverKey;

  exactKeys(receiver, [
    "institutionId", "keyId", "version", "fingerprint",
  ]);

  if (
    !ID.test(receiver.institutionId) ||
    !ID.test(receiver.keyId) ||
    !Number.isSafeInteger(receiver.version) ||
    receiver.version < 1 ||
    !HASH.test(receiver.fingerprint)
  ) {
    throw new Error("Invalid receiver key identity");
  }

  const ephemeral = payload.ephemeralPublicKey;

  const allowedJwkKeys = [
    "kty", "crv", "x", "y", "ext", "key_ops",
  ];

  if (
    !ephemeral ||
    typeof ephemeral !== "object" ||
    Array.isArray(ephemeral) ||
    Object.keys(ephemeral).some(
      (key) => !allowedJwkKeys.includes(key)
    )
  ) {
    throw new Error("Unexpected ephemeral JWK fields");
  }

  if (
    ephemeral.kty !== "EC" ||
    ephemeral.crv !== "P-256" ||
    !COORD.test(ephemeral.x) ||
    !COORD.test(ephemeral.y) ||
    (ephemeral.ext !== undefined && ephemeral.ext !== true) ||
    (ephemeral.key_ops !== undefined &&
      (!Array.isArray(ephemeral.key_ops) ||
        ephemeral.key_ops.length !== 0))
  ) {
    throw new Error("Invalid ephemeral public key");
  }

  validateCryptoLengths(payload);

  const canonical = {
    version: 2,
    algorithm: ALGORITHM,
    receiverKey: {
      institutionId: receiver.institutionId,
      keyId: receiver.keyId,
      version: receiver.version,
      fingerprint: receiver.fingerprint,
    },
    ciphertext: base64(payload.ciphertext),
    iv: base64(payload.iv),
    wrappedKey: base64(payload.wrappedKey),
    wrapIv: base64(payload.wrapIv),
    salt: base64(payload.salt),
    ephemeralPublicKey: {
      kty: "EC",
      crv: "P-256",
      x: ephemeral.x,
      y: ephemeral.y,
    },
  };

  return "NexusMed-Envelope-v2\n" + JSON.stringify(canonical);
}


export function calculateEnvelopeV2Hash(payload) {
  return createHash("sha256")
    .update(canonicalEnvelopeV2(payload), "utf8")
    .digest("hex");
}


/**
 * Node.js cryptographic validation of the ephemeral P-256 point.
 * Call this before accepting an Envelope v2.
 */
export function validateEnvelopeV2Point(payload) {
  canonicalEnvelopeV2(payload);

  const { kty, crv, x, y } = payload.ephemeralPublicKey;

  try {
    const key = createPublicKey({
      key: { kty, crv, x, y },
      format: "jwk",
    });

    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error("Unexpected EC curve");
    }
  } catch {
    throw new Error("Invalid P-256 ephemeral public key point");
  }

  return true;
}
