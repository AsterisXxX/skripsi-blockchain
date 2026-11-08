import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import Database from "better-sqlite3";

import {
  inspectReferralReconciliation,
} from "../src/services/referralReconciliationService.js";

const ciphertext = Buffer.from("synthetic-encrypted-data");

const hash = createHash("sha256")
  .update(ciphertext)
  .digest("hex");

const referralId = "REF-RECON-001";

function fixture({
  storage = "ok",
  ledger = "ok",
  registryHash = hash,
} = {}) {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE referral_registry (
      referral_id TEXT PRIMARY KEY,
      document_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      receiver_institution_id TEXT NOT NULL,
      target_department_id TEXT NOT NULL,
      fabric_transaction_id TEXT
    );
  `);

  db.prepare(`
    INSERT INTO referral_registry VALUES (
      ?, ?, 'pending_ledger', 'org2',
      'poli_umum_org2', NULL
    )
  `).run(referralId, registryHash);

  const document = {
    referralId,
    payload: {
      ciphertext: ciphertext.toString("base64"),
      documentHash: hash,
    },
  };

  const minioClient = {
    async getObject() {
      if (storage === "missing") {
        throw Object.assign(new Error("Missing"), {
          code: "NoSuchKey",
        });
      }

      if (storage === "unavailable") {
        throw new Error("Connection failed");
      }

      if (storage === "invalid") {
        return Readable.from([Buffer.from("invalid-json")]);
      }

      return Readable.from([
        Buffer.from(JSON.stringify(document)),
      ]);
    },
  };

  async function getReferralFromFabric() {
    if (ledger === "unavailable") {
      throw new Error("Fabric unavailable");
    }

    if (ledger === "mismatch") {
      return {
        referralId,
        recordHash: "f".repeat(64),
      };
    }

    return {
      referralId,
      recordHash: hash,
    };
  }

  return {
    db,
    minioClient,
    bucket: "synthetic-bucket",
    getReferralFromFabric,
    referralId,
  };
}

async function check(options, expected) {
  const context = fixture(options);

  try {
    const result = await inspectReferralReconciliation(
      context,
    );

    assert.equal(result.status, expected);
    return result;
  } finally {
    context.db.close();
  }
}

test("consistent MinIO and Fabric evidence", async () => {
  const result = await check({}, "ledger_consistent");

  assert.equal(result.storageVerified, true);
  assert.equal(result.ledgerVerified, true);
  assert.equal(result.requiresCommitEvidence, true);
});

test("missing MinIO object", async () => {
  await check({ storage: "missing" }, "storage_missing");
});

test("unavailable MinIO", async () => {
  await check(
    { storage: "unavailable" },
    "storage_unavailable",
  );
});

test("invalid stored document", async () => {
  await check({ storage: "invalid" }, "storage_invalid");
});

test("ciphertext differs from SQLite hash", async () => {
  await check(
    { registryHash: "0".repeat(64) },
    "storage_hash_mismatch",
  );
});

test("unavailable Fabric", async () => {
  const result = await check(
    { ledger: "unavailable" },
    "ledger_unavailable",
  );

  assert.equal(result.storageVerified, true);
});

test("ledger ciphertext hash mismatch", async () => {
  await check(
    { ledger: "mismatch" },
    "ledger_mismatch",
  );
});

test("missing registry fails closed", async () => {
  const context = fixture();

  try {
    context.db.prepare(`
      DELETE FROM referral_registry
    `).run();

    const result = await inspectReferralReconciliation(
      context,
    );

    assert.equal(result.status, "registry_missing");
  } finally {
    context.db.close();
  }
});
