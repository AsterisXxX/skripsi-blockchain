/**
 * NexusMed M15 - candidate Fabric journal integration policy.
 *
 * No process.env access, database access, or Fabric calls.
 *
 * This policy is intentionally separate from
 * NEXUSMED_REFERRAL_WRITE_MODE.
 *
 * It never authorizes submission or registry commit.
 */

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const TXID = /^[a-f0-9]{64}$/;

const MODES = new Set([
  "disabled",
  "prepare_only",
]);

function fail(code) {
  throw new Error(`FABRIC_JOURNAL_POLICY_${code}`);
}

export function evaluateFabricJournalPolicyV3({
  mode = "disabled",
  referralId,
  transactionId,
  documentHash,
  timestamp,
  registry,
  storageConfirmed = false,
} = {}) {
  if (!MODES.has(mode)) {
    fail("INVALID_MODE");
  }

  if (mode === "disabled") {
    return Object.freeze({
      mode,
      journalRequired: false,
      readyToPrepare: false,
      allowFabricSubmit: false,
      allowRegistryCommit: false,
      allowFabricRetry: false,
    });
  }

  if (
    typeof referralId !== "string" ||
    !ID.test(referralId) ||
    typeof transactionId !== "string" ||
    !TXID.test(transactionId) ||
    typeof documentHash !== "string" ||
    !HASH.test(documentHash) ||
    typeof timestamp !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    fail("INVALID_METADATA");
  }

  if (storageConfirmed !== true) {
    fail("STORAGE_NOT_CONFIRMED");
  }

  if (
    !registry ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    registry.referral_id !== referralId ||
    registry.document_hash !== documentHash ||
    registry.status !== "pending_ledger"
  ) {
    fail("REGISTRY_NOT_READY");
  }

  return Object.freeze({
    mode,
    journalRequired: true,
    readyToPrepare: true,
    allowFabricSubmit: false,
    allowRegistryCommit: false,
    allowFabricRetry: false,
  });
}
