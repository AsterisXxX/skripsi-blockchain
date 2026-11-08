import { createHash } from "node:crypto";

function decodeCanonicalBase64(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error("INVALID_BASE64");
  }

  const bytes = Buffer.from(value, "base64");

  if (
    bytes.length === 0 ||
    bytes.toString("base64") !== value
  ) {
    throw new Error("INVALID_BASE64");
  }

  return bytes;
}

/**
 * Read-only reconciliation.
 *
 * Dependencies are injected for isolated testing.
 * No MinIO writes, Fabric submissions, or SQLite updates.
 */
export async function inspectReferralReconciliation({
  db,
  minioClient,
  bucket,
  getReferralFromFabric,
  referralId,
}) {
  if (
    typeof referralId !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(referralId)
  ) {
    return { status: "invalid_id" };
  }

  const registry = db.prepare(`
    SELECT
      referral_id,
      document_hash,
      status,
      receiver_institution_id,
      target_department_id,
      fabric_transaction_id
    FROM referral_registry
    WHERE referral_id = ?
  `).get(referralId);

  if (!registry) {
    return { status: "registry_missing", referralId };
  }

  const objectKey = `referrals/${referralId}.json`;

  let document;

  try {
    const stream = await minioClient.getObject(
      bucket,
      objectKey,
    );

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    document = Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (
      error.code === "NotFound" ||
      error.code === "NoSuchKey"
    ) {
      return {
        status: "storage_missing",
        referralId,
        registryStatus: registry.status,
      };
    }

    return {
      status: "storage_unavailable",
      referralId,
      registryStatus: registry.status,
    };
  }

  let calculatedHash;

  try {
    document = JSON.parse(document);

    if (
      document.referralId !== referralId ||
      typeof document.payload !== "object" ||
      document.payload === null
    ) {
      throw new Error("INVALID_DOCUMENT");
    }

    const ciphertext = decodeCanonicalBase64(
      document.payload.ciphertext,
    );

    calculatedHash = createHash("sha256")
      .update(ciphertext)
      .digest("hex");
  } catch {
    return {
      status: "storage_invalid",
      referralId,
      registryStatus: registry.status,
    };
  }

  if (
    calculatedHash !== registry.document_hash ||
    document.payload.documentHash !== calculatedHash
  ) {
    return {
      status: "storage_hash_mismatch",
      referralId,
      registryStatus: registry.status,
    };
  }

  let ledger;

  try {
    ledger = await getReferralFromFabric(referralId);
  } catch {
    return {
      status: "ledger_unavailable",
      referralId,
      registryStatus: registry.status,
      storageVerified: true,
    };
  }

  if (
    !ledger ||
    ledger.referralId !== referralId ||
    ledger.recordHash !== calculatedHash
  ) {
    return {
      status: "ledger_mismatch",
      referralId,
      registryStatus: registry.status,
      storageVerified: true,
    };
  }

  return {
    status: "ledger_consistent",
    referralId,
    registryStatus: registry.status,
    storageVerified: true,
    ledgerVerified: true,
    requiresCommitEvidence:
      registry.status !== "committed" ||
      !registry.fabric_transaction_id,
  };
}
