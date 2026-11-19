/**
 * NexusMed M15 - candidate anti-downgrade guard.
 *
 * Read-only; requires caller-supplied SQLite connection.
 *
 * This only selects an eligible orchestration path.
 * It never authorizes Fabric submission, retry, or commit.
 *
 * Must eventually run BEFORE the legacy Fabric call.
 */

import {
  inspectFabricJournalSchemaV3,
} from "./fabricJournalSchemaGuardV3.js";

import {
  findFabricSubmissionV3,
} from "./fabricSubmissionJournalV3.js";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MODES = new Set(["disabled", "prepare_only"]);

function decision(path, reason) {
  return Object.freeze({
    path,
    reason,
    allowFabricSubmit: false,
    allowFabricRetry: false,
    allowRegistryCommit: false,
  });
}

export function decideFabricJournalPathV3({
  db,
  referralId,
  mode = "disabled",
} = {}) {
  if (
    !db ||
    typeof db.prepare !== "function" ||
    typeof referralId !== "string" ||
    !ID.test(referralId)
  ) {
    throw new Error("JOURNAL_DOWNGRADE_INVALID_INPUT");
  }

  if (!MODES.has(mode)) {
    throw new Error("JOURNAL_DOWNGRADE_INVALID_MODE");
  }

  // Inspect even when disabled. A drifted journal
  // must not silently trigger legacy fallback.
  const schema = inspectFabricJournalSchemaV3(db);

  if (!schema.present) {
    if (mode === "prepare_only") {
      throw new Error(
        "JOURNAL_DOWNGRADE_SCHEMA_REQUIRED"
      );
    }

    return decision(
      "legacy",
      "JOURNAL_SCHEMA_NOT_INSTALLED"
    );
  }

  if (!schema.compatible) {
    throw new Error("JOURNAL_DOWNGRADE_SCHEMA_INVALID");
  }

  // Always check for a previous attempt.
  // Feature gate state cannot override this evidence.
  const existing = findFabricSubmissionV3(
    db,
    referralId
  );

  if (existing) {
    return decision(
      "blocked",
      "EXISTING_FABRIC_ATTEMPT_REQUIRES_RECONCILIATION"
    );
  }

  if (mode === "disabled") {
    return decision(
      "legacy",
      "NO_EXISTING_JOURNAL_AND_GATE_DISABLED"
    );
  }

  return decision(
    "journal_candidate",
    "JOURNAL_PREPARATION_REQUIRED"
  );
}
