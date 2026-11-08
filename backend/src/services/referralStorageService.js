import {
  markStorageCompleted,
} from "./referralRegistryService.js";

/**
 * Storage operation may fail after the remote service
 * has accepted the object. Never assume a failed response
 * means the object does not exist.
 *
 * Pending records must be reconciled before retrying.
 */
export async function storeReferralCiphertext({
  db,
  minioClient,
  bucket,
  objectKey,
  buffer,
  referralId,
}) {
  try {
    await minioClient.putObject(
      bucket,
      objectKey,
      buffer,
      buffer.length,
      { "Content-Type": "application/json" },
    );
  } catch {
    return {
      ok: false,
      status: "pending_storage",
      reason: "storage_unconfirmed",
    };
  }

  try {
    markStorageCompleted(db, referralId);
  } catch {
    return {
      ok: false,
      status: "pending_storage",
      reason: "registry_transition_unconfirmed",
    };
  }

  return {
    ok: true,
    status: "pending_ledger",
  };
}
