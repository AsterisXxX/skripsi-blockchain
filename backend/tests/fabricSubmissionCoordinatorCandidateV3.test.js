import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  migrateFabricSubmissionJournalV3,
} from "../src/services/fabricSubmissionJournalMigrationV3.js";

import {
  migrateTxIdOwnershipCandidateV3,
} from "../src/services/fabricSubmissionOwnershipTxIdCandidateV3.js";

import {
  migrateAdmissionCandidateV3,
} from "../src/services/fabricAdmissionCandidateV3.js";


import {
  coordinateFabricSubmissionCandidateV3,
} from "../src/services/fabricSubmissionCoordinatorCandidateV3.js";

const REF = "REF-COORD-072";
const PAT = "PAT-SYNTH-072";
const HASH = "a".repeat(64);
const TX = "b".repeat(64);
const TIME = "2026-11-19T17:20:00.000Z";

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE referral_registry (
      referral_id TEXT PRIMARY KEY,
      document_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      fabric_transaction_id TEXT
    );
  `);

  db.prepare(`
    INSERT INTO referral_registry
      (referral_id, document_hash, status)
    VALUES (?, ?, 'pending_ledger')
  `).run(REF, HASH);

  migrateFabricSubmissionJournalV3(db);
  migrateTxIdOwnershipCandidateV3(db);
  migrateAdmissionCandidateV3(db);

  db.prepare(`
    INSERT INTO fabric_submission_admission_candidate_v3
      (referral_id, document_hash)
    VALUES (?, ?)
  `).run(REF, HASH);

  return db;
}

function ownership(db) {
  return db.prepare(`
    SELECT owner, transaction_id
    FROM fabric_submission_ownership_txid_candidate_v3
    WHERE referral_id = ?
  `).get(REF);
}

function journal(db) {
  return db.prepare(`
    SELECT transaction_id
    FROM fabric_submission_journal_v3
    WHERE referral_id = ?
  `).get(REF);
}

function fakeContract(db, state, txid = TX) {
  return {
    createTransaction(name) {
      state.created++;
      assert.equal(name, "CreateReferral");

      return {
        setEndorsingOrganizations(...orgs) {
          assert.deepEqual(
            orgs,
            ["Org1MSP", "Org2MSP"]
          );
        },

        getTransactionId() {
          return txid;
        },

        async submit(...args) {
          state.submitted++;

          // The same TxID must already be durable.
          const record = ownership(db);
          assert.ok(record);
          assert.equal(record.transaction_id, txid);

          if (record.owner === "journal") {
            assert.equal(journal(db).transaction_id, txid);
          }

          assert.deepEqual(args, [
            REF, PAT, "Org2MSP", HASH, TIME,
          ]);

          if (state.fail) {
            throw new Error("synthetic timeout");
          }

          return Buffer.from("synthetic");
        },
      };
    },
  };
}

function run(db, state, owner, overrides = {}) {
  return coordinateFabricSubmissionCandidateV3({
    db,
    contract: fakeContract(db, state),
    owner,
    referralId: REF,
    patientId: PAT,
    documentHash: HASH,
    timestamp: TIME,
    storageConfirmed: true,
    ...overrides,
  });
}

test("legacy coordinator prepares before submit", async () => {
  const db = fixture();
  try {
    const state = { created: 0, submitted: 0 };
    const result = await run(db, state, "legacy");

    assert.equal(state.submitted, 1);
    assert.equal(ownership(db).owner, "legacy");
    assert.equal(ownership(db).transaction_id, TX);
    assert.equal(journal(db), undefined);
    assert.equal(result.allowFabricRetry, false);
    assert.equal(result.allowRegistryCommit, false);
  } finally {
    db.close();
  }
});

test("journal coordinator persists matching TxID", async () => {
  const db = fixture();
  try {
    const state = { created: 0, submitted: 0 };
    const result = await run(db, state, "journal");

    assert.equal(state.submitted, 1);
    assert.equal(ownership(db).owner, "journal");
    assert.equal(journal(db).transaction_id, TX);
    assert.equal(result.status, "pending_evidence");
  } finally {
    db.close();
  }
});

test("legacy then journal cannot submit twice", async () => {
  const db = fixture();
  try {
    const state = { created: 0, submitted: 0 };

    await run(db, state, "legacy");

    await assert.rejects(
      run(db, state, "journal"),
      error => (
        error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
        error.code === "SQLITE_CONSTRAINT_UNIQUE"
      )
    );

    assert.equal(state.submitted, 1);
  } finally {
    db.close();
  }
});

test("journal then legacy cannot submit twice", async () => {
  const db = fixture();
  try {
    const state = { created: 0, submitted: 0 };

    await run(db, state, "journal");

    await assert.rejects(
      run(db, state, "legacy"),
      /OWNERSHIP_TXID_EXISTING_JOURNAL/
    );

    assert.equal(state.submitted, 1);
  } finally {
    db.close();
  }
});

test("unknown outcome preserves claim and blocks retry", async () => {
  const db = fixture();
  try {
    const state = {
      created: 0,
      submitted: 0,
      fail: true,
    };

    await assert.rejects(
      run(db, state, "legacy"),
      /COORDINATOR_SUBMISSION_UNCONFIRMED/
    );

    assert.equal(ownership(db).transaction_id, TX);

    state.fail = false;

    await assert.rejects(
      run(db, state, "legacy"),
      error => (
        error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
        error.code === "SQLITE_CONSTRAINT_UNIQUE"
      )
    );

    assert.equal(state.submitted, 1);
  } finally {
    db.close();
  }
});

test("journal INSERT failure prevents submit", async () => {
  const db = fixture();
  try {
    const state = { created: 0, submitted: 0 };

    db.exec(`
      CREATE TRIGGER fault_journal_072
      BEFORE INSERT ON fabric_submission_journal_v3
      BEGIN
        SELECT RAISE(
          ABORT,
          'SYNTHETIC_JOURNAL_FAILURE'
        );
      END;
    `);

    await assert.rejects(
      run(db, state, "journal"),
      /SYNTHETIC_JOURNAL_FAILURE/
    );

    assert.equal(state.submitted, 0);
    assert.equal(ownership(db), undefined);
    assert.equal(journal(db), undefined);
  } finally {
    db.close();
  }
});

test("missing storage confirmation fails closed", async () => {
  const db = fixture();
  try {
    const state = { created: 0, submitted: 0 };

    await assert.rejects(
      run(db, state, "legacy", {
        storageConfirmed: false,
      }),
      /COORDINATOR_PRECONDITION_FAILED/
    );

    assert.equal(state.created, 0);
    assert.equal(state.submitted, 0);
    assert.equal(ownership(db), undefined);
  } finally {
    db.close();
  }
});
