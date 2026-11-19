import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  migrateFabricSubmissionJournalV3,
} from "../src/services/fabricSubmissionJournalMigrationV3.js";

import {
  migrateTxIdOwnershipCandidateV3,
} from "../src/services/fabricSubmissionOwnershipTxIdCandidateV3.js";

import {
  migrateAdmissionCandidateV3,
} from "../src/services/fabricAdmissionCandidateV3.js";


const REF = "REF-COORD-RACE-073";
const HASH = "a".repeat(64);
const TIME = "2026-11-19T17:30:00.000Z";

const TX_A = "b".repeat(64);
const TX_B = "c".repeat(64);

const coordinatorUrl = new URL(
  "../src/services/fabricSubmissionCoordinatorCandidateV3.js",
  import.meta.url
).href;

function open(path) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

function fixture(t) {
  const dir = mkdtempSync(
    join(tmpdir(), "nexusmed-coordinator-073-")
  );

  const path = join(dir, "synthetic.sqlite");

  t.after(() => {
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  });

  const db = open(path);

  try {
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
  } finally {
    db.close();
  }

  return path;
}

const workerSource = `
import Database from "better-sqlite3";

const [path, owner, txid, moduleUrl] =
  process.argv.slice(1);

const { coordinateFabricSubmissionCandidateV3 } =
  await import(moduleUrl);

const db = new Database(path);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

let started = false;

const state = {
  submitted: 0,
};

const contract = {
  createTransaction(name) {
    if (name !== "CreateReferral") {
      throw new Error("INVALID_CHAINCODE_FUNCTION");
    }

    return {
      setEndorsingOrganizations(...orgs) {
        if (
          orgs.join(",") !== "Org1MSP,Org2MSP"
        ) {
          throw new Error("INVALID_ENDORSERS");
        }
      },

      getTransactionId() {
        return txid;
      },

      async submit() {
        const record = db.prepare(\`
          SELECT owner, transaction_id
          FROM fabric_submission_ownership_txid_candidate_v3
          WHERE referral_id = ?
        \`).get("${REF}");

        if (
          !record ||
          record.owner !== owner ||
          record.transaction_id !== txid
        ) {
          throw new Error("OWNERSHIP_MISMATCH");
        }

        if (owner === "journal") {
          const journal = db.prepare(\`
            SELECT transaction_id
            FROM fabric_submission_journal_v3
            WHERE referral_id = ?
          \`).get("${REF}");

          if (journal?.transaction_id !== txid) {
            throw new Error("JOURNAL_MISMATCH");
          }
        }

        state.submitted++;
        return Buffer.from("synthetic");
      },
    };
  },
};

process.send({ type: "ready" });

process.on("message", async message => {
  if (message?.type !== "go" || started) return;
  started = true;

  let result;

  try {
    await coordinateFabricSubmissionCandidateV3({
      db,
      contract,
      owner,
      referralId: "${REF}",
      patientId: "PAT-SYNTH-073",
      receiverId: "Org2MSP",
      documentHash: "${HASH}",
      timestamp: "${TIME}",
      storageConfirmed: true,
    });

    result = "claimed";
  } catch (error) {
    result = "rejected";
  }

  db.close();

  process.send({
    type: "done",
    result,
    owner,
    txid,
    submitted: state.submitted,
  }, () => process.exit(0));
});
`;

function startWorker(path, owner, txid) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      workerSource,
      path,
      owner,
      txid,
      coordinatorUrl,
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }
  );

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => {
    stderr += chunk;
  });

  let readyResolve, readyReject;
  let doneResolve, doneReject;
  let settledReady = false;
  let settledDone = false;

  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const done = new Promise((resolve, reject) => {
    doneResolve = resolve;
    doneReject = reject;
  });

  child.on("message", message => {
    if (message.type === "ready" && !settledReady) {
      settledReady = true;
      readyResolve();
    }

    if (message.type === "done" && !settledDone) {
      settledDone = true;
      doneResolve(message);
    }
  });

  const fail = error => {
    if (!settledReady) {
      settledReady = true;
      readyReject(error);
    }
    if (!settledDone) {
      settledDone = true;
      doneReject(error);
    }
  };

  child.on("error", fail);

  child.on("exit", (code, signal) => {
    if (!settledDone || !settledReady) {
      fail(new Error(
        "WORKER_EXIT " +
        JSON.stringify({ code, signal, stderr })
      ));
    }
  });

  return { child, ready, done };
}

function inspect(path) {
  const db = open(path);

  try {
    const ownership = db.prepare(`
      SELECT owner, transaction_id, document_hash
      FROM fabric_submission_ownership_txid_candidate_v3
    `).all();

    const journals = db.prepare(`
      SELECT transaction_id, document_hash
      FROM fabric_submission_journal_v3
    `).all();

    return { ownership, journals };
  } finally {
    db.close();
  }
}

async function runRace(t, ownerA, ownerB) {
  const path = fixture(t);

  const workers = [
    startWorker(path, ownerA, TX_A),
    startWorker(path, ownerB, TX_B),
  ];

  t.after(() => {
    for (const worker of workers) {
      if (worker.child.exitCode === null) {
        worker.child.kill();
      }
    }
  });

  // Both processes are ready before either attempts
  // to acquire ownership.
  await Promise.all(workers.map(w => w.ready));

  for (const worker of workers) {
    worker.child.send({ type: "go" });
  }

  const results = await Promise.all(
    workers.map(w => w.done)
  );

  assert.deepEqual(
    results.map(r => r.result).sort(),
    ["claimed", "rejected"]
  );

  assert.equal(
    results.reduce((sum, r) => sum + r.submitted, 0),
    1
  );

  const winner = results.find(
    r => r.result === "claimed"
  );

  const loser = results.find(
    r => r.result === "rejected"
  );

  assert.equal(winner.submitted, 1);
  assert.equal(loser.submitted, 0);
  assert.notEqual(winner.txid, loser.txid);

  const data = inspect(path);

  assert.equal(data.ownership.length, 1);
  assert.equal(
    data.ownership[0].transaction_id,
    winner.txid
  );
  assert.equal(
    data.ownership[0].owner,
    winner.owner
  );
  assert.equal(
    data.ownership[0].document_hash,
    HASH
  );

  if (winner.owner === "journal") {
    assert.equal(data.journals.length, 1);
    assert.equal(
      data.journals[0].transaction_id,
      winner.txid
    );
  } else {
    assert.equal(data.journals.length, 0);
  }
}

test(
  "legacy vs journal: only winner submits",
  { timeout: 15000 },
  async t => runRace(t, "legacy", "journal")
);

test(
  "journal vs legacy: only winner submits",
  { timeout: 15000 },
  async t => runRace(t, "journal", "legacy")
);

test(
  "legacy vs legacy: only winner submits",
  { timeout: 15000 },
  async t => runRace(t, "legacy", "legacy")
);

test(
  "journal vs journal: only winner submits",
  { timeout: 15000 },
  async t => runRace(t, "journal", "journal")
);
