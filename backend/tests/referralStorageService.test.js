import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  storeReferralCiphertext,
} from "../src/services/referralStorageService.js";

function fixture() {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE referral_registry (
      referral_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT
    );

    INSERT INTO referral_registry
      (referral_id, status)
    VALUES ('REF-STORAGE-TEST', 'pending_storage');
  `);

  return db;
}

function status(db) {
  return db.prepare(`
    SELECT status
    FROM referral_registry
    WHERE referral_id = 'REF-STORAGE-TEST'
  `).get().status;
}

function params(db, putObject) {
  return {
    db,
    minioClient: { putObject },
    bucket: "test-bucket",
    objectKey: "referrals/REF-STORAGE-TEST.json",
    buffer: Buffer.from('{"test":true}'),
    referralId: "REF-STORAGE-TEST",
  };
}

test("successful storage advances to pending_ledger", async () => {
  const db = fixture();

  try {
    let calls = 0;

    const result = await storeReferralCiphertext(
      params(db, async () => {
        calls += 1;
      }),
    );

    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.status, "pending_ledger");
    assert.equal(status(db), "pending_ledger");
  } finally {
    db.close();
  }
});

test("MinIO failure preserves pending_storage", async () => {
  const db = fixture();

  try {
    const result = await storeReferralCiphertext(
      params(db, async () => {
        throw new Error("Synthetic MinIO failure");
      }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "storage_unconfirmed");
    assert.equal(status(db), "pending_storage");
  } finally {
    db.close();
  }
});

test("registry transition failure does not advance to Fabric", async () => {
  const db = fixture();

  try {
    db.prepare(`
      UPDATE referral_registry
      SET status = 'failed'
      WHERE referral_id = 'REF-STORAGE-TEST'
    `).run();

    const result = await storeReferralCiphertext(
      params(db, async () => {}),
    );

    assert.equal(result.ok, false);
    assert.equal(
      result.reason,
      "registry_transition_unconfirmed"
    );
    assert.equal(status(db), "failed");
  } finally {
    db.close();
  }
});
