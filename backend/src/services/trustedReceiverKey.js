import { createHash, createPublicKey } from "node:crypto";
import {
  validateEnvelopeV2Point,
} from "./envelopeIntegrity.js";
import {
  validateReceiverKeyBinding,
} from "./envelopeReceiverBinding.js";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const COORD = /^[A-Za-z0-9_-]{43}$/;

function validateRegisteredPublicKey(record) {
  let jwk;

  try {
    jwk = JSON.parse(record.public_key_jwk);
  } catch {
    throw new Error("Invalid registered public key JSON");
  }

  if (
    !jwk ||
    typeof jwk !== "object" ||
    Array.isArray(jwk) ||
    Object.keys(jwk).some(
      key => !["kty", "crv", "x", "y", "ext", "key_ops"].includes(key)
    ) ||
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    !COORD.test(jwk.x) ||
    !COORD.test(jwk.y) ||
    (jwk.ext !== undefined && jwk.ext !== true) ||
    (jwk.key_ops !== undefined &&
      (!Array.isArray(jwk.key_ops) || jwk.key_ops.length !== 0))
  ) {
    throw new Error("Invalid registered P-256 public key");
  }

  const decodeCoordinate = value => {
    const bytes = Buffer.from(value, "base64url");

    if (
      bytes.length !== 32 ||
      bytes.toString("base64url") !== value
    ) {
      throw new Error("Invalid registered public key coordinate");
    }

    return bytes;
  };

  const point = Buffer.concat([
    Buffer.from([0x04]),
    decodeCoordinate(jwk.x),
    decodeCoordinate(jwk.y),
  ]);

  const fingerprint = createHash("sha256")
    .update(point)
    .digest("hex");

  if (fingerprint !== record.fingerprint) {
    throw new Error("Registered public key fingerprint mismatch");
  }

  try {
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: jwk.x,
        y: jwk.y,
      },
      format: "jwk",
    });

    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error("Unexpected curve");
    }
  } catch {
    throw new Error("Invalid registered P-256 point");
  }

  return fingerprint;
}

/**
 * Intended for new Envelope v2 referral submissions.
 *
 * db must be supplied by the trusted backend.
 * No private keys are loaded.
 * No writes are performed.
 */
export function verifyNewReferralReceiverKey(
  db,
  payload,
  expectedReceiverInstitutionId
) {
  if (
    typeof expectedReceiverInstitutionId !== "string" ||
    !ID.test(expectedReceiverInstitutionId)
  ) {
    throw new Error("Invalid expected receiver institution");
  }

  const record = db.prepare(`
    SELECT
      k.key_id,
      k.institution_id,
      k.version,
      k.public_key_jwk,
      k.fingerprint,
      k.status,
      k.retired_at
    FROM institution_public_keys k
    JOIN institutions i
      ON i.id = k.institution_id
    WHERE k.institution_id = ?
      AND k.status = 'active'
      AND k.retired_at IS NULL
      AND i.status = 'approved'
      AND i.can_receive = 1
  `).get(expectedReceiverInstitutionId);

  if (!record) {
    throw new Error("Eligible active receiver key unavailable");
  }

  // Validate cryptographic point in the incoming envelope.
  validateEnvelopeV2Point(payload);

  // Verify that the stored registry JWK matches its fingerprint.
  validateRegisteredPublicKey(record);

  // Bind the claimed identity to the trusted database record.
  return validateReceiverKeyBinding(
    payload,
    record,
    expectedReceiverInstitutionId
  );
}
