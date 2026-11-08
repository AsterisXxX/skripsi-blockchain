import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  createReferralIntent,
  markStorageCompleted,
  markLedgerCommitted,
} from "../src/services/referralRegistryService.js";

function fixture() {
  const db = new Database(":memory:");

  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE institutions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      can_send INTEGER NOT NULL,
      can_receive INTEGER NOT NULL
    );

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE(institution_id, id)
    );

    CREATE TABLE referral_registry (
      referral_id TEXT PRIMARY KEY,
      sender_institution_id TEXT NOT NULL,
      receiver_institution_id TEXT NOT NULL,
      target_department_id TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      fabric_transaction_id TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (
        receiver_institution_id,
        target_department_id
      ) REFERENCES departments(institution_id, id)
    );

    INSERT INTO institutions VALUES
      ('fktp-a', 'approved', 1, 0),
      ('fkrtl-x', 'approved', 0, 1),
      ('fkrtl-y', 'approved', 0, 1);

    INSERT INTO departments VALUES
      ('jantung-x', 'fkrtl-x', 'active'),
      ('saraf-x', 'fkrtl-x', 'active'),
      ('jantung-y', 'fkrtl-y', 'active');
  `);

  return db;
}

const valid = {
  referralId: "REF-TEST-001",
  senderInstitutionId: "fktp-a",
  receiverInstitutionId: "fkrtl-x",
  targetDepartmentId: "jantung-x",
  documentHash: "a".repeat(64),
};

function withDb(callback) {
  const db = fixture();
  try {
    callback(db);
  } finally {
    db.close();
  }
}

test("creates pending referral metadata", () => withDb(db => {
  const result = createReferralIntent(db, valid);
  assert.equal(result.status, "pending_storage");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM referral_registry").get().n,
    1
  );
}));

test("rejects destination in different institution", () => withDb(db => {
  assert.throws(
    () => createReferralIntent(db, {
      ...valid,
      targetDepartmentId: "jantung-y",
    }),
    /INVALID_RECEIVER_DEPARTMENT/
  );
}));

test("rejects intra-institution referral", () => withDb(db => {
  assert.throws(
    () => createReferralIntent(db, {
      ...valid,
      senderInstitutionId: "fkrtl-x",
    }),
    /INTRA_INSTITUTION_NOT_SUPPORTED/
  );
}));

test("rejects institution without sending permission", () => withDb(db => {
  assert.throws(
    () => createReferralIntent(db, {
      ...valid,
      senderInstitutionId: "fkrtl-y",
    }),
    /SENDER_NOT_AUTHORIZED/
  );
}));

test("rejects invalid hash", () => withDb(db => {
  assert.throws(
    () => createReferralIntent(db, {
      ...valid,
      documentHash: "not-a-hash",
    }),
    /INVALID_REFERRAL_METADATA/
  );
}));

test("rejects duplicate referral ID", () => withDb(db => {
  createReferralIntent(db, valid);
  assert.throws(() => createReferralIntent(db, valid));
}));

test("transitions only after storage and ledger success", () => withDb(db => {
  createReferralIntent(db, valid);
  markStorageCompleted(db, valid.referralId);
  markLedgerCommitted(db, valid.referralId, "tx-123");

  const row = db.prepare(`
    SELECT status, fabric_transaction_id
    FROM referral_registry
    WHERE referral_id = ?
  `).get(valid.referralId);

  assert.equal(row.status, "committed");
  assert.equal(row.fabric_transaction_id, "tx-123");
}));

test("cannot commit before storage completion", () => withDb(db => {
  createReferralIntent(db, valid);

  assert.throws(
    () => markLedgerCommitted(db, valid.referralId, "tx-123"),
    /INVALID_LEDGER_TRANSITION/
  );
}));

test("cannot repeat storage transition", () => withDb(db => {
  createReferralIntent(db, valid);
  markStorageCompleted(db, valid.referralId);

  assert.throws(
    () => markStorageCompleted(db, valid.referralId),
    /INVALID_STORAGE_TRANSITION/
  );
}));
