import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";

import {
  createReferralIntent,
  markStorageCompleted,
} from "../src/services/referralRegistryService.js";

import {
  migrateAdmissionCandidateV3,
} from "../src/services/fabricAdmissionCandidateV3.js";

import {
  migrateTxIdOwnershipCandidateV3,
} from "../src/services/fabricSubmissionOwnershipTxIdCandidateV3.js";

import {
  migrateFabricSubmissionJournalV3,
} from "../src/services/fabricSubmissionJournalMigrationV3.js";

import {
  createAdmittedRegistryIntentCandidateV3,
} from "../src/services/fabricRegistryAdmissionIntegrationCandidateV3.js";

import {
  executeHttpSubmissionBoundaryCandidateV3,
} from "../src/services/fabricHttpSubmissionBoundaryCandidateV3.js";

const HASH = "a".repeat(64);
const TXID = "b".repeat(64);

function input(referralId) {
  return {
    referralId,
    senderInstitutionId: "org1",
    receiverInstitutionId: "org2",
    targetDepartmentId: "poli_umum_org2",
    documentHash: HASH,
  };
}

function fixture({ migrate = true } = {}) {
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
      id TEXT NOT NULL,
      institution_id TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE(institution_id, id)
    );

    CREATE TABLE referral_registry (
      referral_id TEXT PRIMARY KEY,
      sender_institution_id TEXT NOT NULL
        REFERENCES institutions(id),
      receiver_institution_id TEXT NOT NULL
        REFERENCES institutions(id),
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
      ('org1', 'approved', 1, 0),
      ('org2', 'approved', 0, 1);

    INSERT INTO departments VALUES
      ('poli_umum_org2', 'org2', 'active');
  `);

  if (migrate) {
    migrateFabricSubmissionJournalV3(db);
    migrateTxIdOwnershipCandidateV3(db);
    migrateAdmissionCandidateV3(db);
  }

  return db;
}

function fakeContract({ fail = false } = {}) {
  const calls = {
    created: 0,
    submitted: 0,
  };

  return {
    calls,
    createTransaction(name) {
      assert.equal(name, "CreateReferral");
      calls.created++;

      return {
        getTransactionId() {
          return TXID;
        },
        setEndorsingOrganizations(...orgs) {
          assert.deepEqual(orgs, [
            "Org1MSP", "Org2MSP",
          ]);
        },
        async submit() {
          calls.submitted++;

          if (fail) {
            throw new Error("SYNTHETIC_SUBMIT_UNKNOWN");
          }
        },
      };
    },
  };
}

async function withHttp(db, contract, action) {
  const app = express();
  app.use(express.json());

  app.post("/candidate/referrals/submit", async (req, res) => {
    const result =
      await executeHttpSubmissionBoundaryCandidateV3({
        db,
        contract,
        ...req.body,
      });

    res.status(result.code).json(result.body);
  });

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });

  const url =
    `http://127.0.0.1:${server.address().port}` +
    "/candidate/referrals/submit";

  async function post(referralId, storageConfirmed = true) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referralId,
        patientId: "PAT-SYNTH-084D",
        receiverId: "Org2MSP",
        documentHash: HASH,
        timestamp: "2026-11-19T19:00:00.000Z",
        storageConfirmed,
      }),
    });

    return {
      code: response.status,
      body: await response.json(),
    };
  }

  try {
    await action(post);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function registryStatus(db, id) {
  return db.prepare(`
    SELECT status
    FROM referral_registry
    WHERE referral_id = ?
  `).get(id)?.status;
}

function ownershipCount(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM fabric_submission_ownership_txid_candidate_v3
  `).get().n;
}

test("84D: missing schema returns 503 without submit", async () => {
  const db = fixture({ migrate: false });
  const contract = fakeContract();

  try {
    await withHttp(db, contract, async post => {
      const result = await post("REF-SCHEMA-084D");

      assert.equal(result.code, 503);
      assert.equal(result.body.status, "unavailable");
      assert.equal(contract.calls.created, 0);
      assert.equal(contract.calls.submitted, 0);
    });
  } finally {
    db.close();
  }
});

test("84D: legacy referral without admission cannot submit", async () => {
  const db = fixture();
  const contract = fakeContract();
  const id = "REF-LEGACY-084D";

  try {
    createReferralIntent(db, input(id));
    markStorageCompleted(db, id);

    await withHttp(db, contract, async post => {
      const result = await post(id);

      assert.equal(result.code, 202);
      assert.equal(result.body.status, "pending_review");
      assert.equal(contract.calls.submitted, 0);
      assert.equal(ownershipCount(db), 0);
      assert.equal(registryStatus(db, id), "pending_ledger");
    });
  } finally {
    db.close();
  }
});

test("84D: unconfirmed storage cannot claim or submit", async () => {
  const db = fixture();
  const contract = fakeContract();
  const id = "REF-STORAGE-084D";

  try {
    createAdmittedRegistryIntentCandidateV3(db, input(id));

    await withHttp(db, contract, async post => {
      const result = await post(id, false);

      assert.equal(result.code, 202);
      assert.equal(result.body.status, "pending_storage");
      assert.equal(contract.calls.created, 0);
      assert.equal(contract.calls.submitted, 0);
      assert.equal(ownershipCount(db), 0);
      assert.equal(registryStatus(db, id), "pending_storage");
    });
  } finally {
    db.close();
  }
});

test("84D: mock submit success stays pending_evidence", async () => {
  const db = fixture();
  const contract = fakeContract();
  const id = "REF-SUCCESS-084D";

  try {
    createAdmittedRegistryIntentCandidateV3(db, input(id));
    markStorageCompleted(db, id);

    await withHttp(db, contract, async post => {
      const result = await post(id);

      assert.equal(result.code, 202);
      assert.equal(result.body.status, "pending_evidence");
      assert.equal(result.body.allowRegistryCommit, false);
      assert.equal(contract.calls.submitted, 1);
      assert.equal(ownershipCount(db), 1);
      assert.equal(registryStatus(db, id), "pending_ledger");
    });
  } finally {
    db.close();
  }
});

test("84D: second request cannot submit twice", async () => {
  const db = fixture();
  const contract = fakeContract();
  const id = "REF-REPLAY-084D";

  try {
    createAdmittedRegistryIntentCandidateV3(db, input(id));
    markStorageCompleted(db, id);

    await withHttp(db, contract, async post => {
      const first = await post(id);
      const second = await post(id);

      assert.equal(first.body.status, "pending_evidence");
      assert.equal(second.body.status, "pending_review");
      assert.equal(contract.calls.submitted, 1);
      assert.equal(ownershipCount(db), 1);
      assert.equal(registryStatus(db, id), "pending_ledger");
    });
  } finally {
    db.close();
  }
});

test("84D: unknown submit outcome preserves ownership", async () => {
  const db = fixture();
  const contract = fakeContract({ fail: true });
  const id = "REF-UNKNOWN-084D";

  try {
    createAdmittedRegistryIntentCandidateV3(db, input(id));
    markStorageCompleted(db, id);

    await withHttp(db, contract, async post => {
      const first = await post(id);
      const second = await post(id);

      assert.equal(first.code, 202);
      assert.equal(first.body.status, "pending_review");
      assert.equal(second.body.status, "pending_review");
      assert.equal(contract.calls.submitted, 1);
      assert.equal(ownershipCount(db), 1);
      assert.equal(registryStatus(db, id), "pending_ledger");
    });
  } finally {
    db.close();
  }
});
