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
  findFabricSubmissionV3,
} from "../src/services/fabricSubmissionJournalV3.js";

import {
  decideFabricJournalPathV3,
} from "../src/services/fabricJournalDowngradeGuardV3.js";

const REF = "REF-RACE-060";
const HASH = "a".repeat(64);
const TXIDS = ["b".repeat(64), "c".repeat(64)];
const TIME = "2026-11-19T16:30:00.000Z";

const workerSource = `
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = resolve("src/services");

const load = async name => import(
  pathToFileURL(resolve(base, name)).href
);

const { prepareFabricSubmissionV3 } =
  await load("fabricSubmissionJournalV3.js");

const { decideFabricJournalPathV3 } =
  await load("fabricJournalDowngradeGuardV3.js");

const db = new Database(process.argv[1]);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const referralId = "${REF}";
const documentHash = "${HASH}";
const txid = process.argv[2];

const decision = decideFabricJournalPathV3({
  db,
  referralId,
  mode: "prepare_only",
});

if (decision.path !== "journal_candidate") {
  process.send({ type: "error", reason: "NOT_CANDIDATE" });
  process.exit(2);
}

// Both workers must reach this point before either
// is permitted to write.
process.send({ type: "ready" });

process.on("message", message => {
  if (message?.type !== "go") return;

  let result;

  try {
    prepareFabricSubmissionV3(db, {
      referralId,
      transactionId: txid,
      documentHash,
      timestamp: "${TIME}",
    });

    result = { type: "done", outcome: "prepared" };
  } catch {
    result = { type: "done", outcome: "rejected" };
  }

  db.close();
  process.send(result, () => process.exit(0));
});
`;

function open(path) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

function createWorker(path, txid) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", workerSource, path, txid],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    }
  );

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => {
    stderr += chunk;
  });

  const messages = [];
  let resolveReady;
  let rejectReady;
  let resolveDone;
  let rejectDone;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  child.on("message", message => {
    messages.push(message);

    if (message.type === "ready") resolveReady();

    if (message.type === "done") {
      resolveDone(message.outcome);
    }

    if (message.type === "error") {
      const error = new Error(message.reason);
      rejectReady(error);
      rejectDone(error);
    }
  });

  child.on("error", error => {
    rejectReady(error);
    rejectDone(error);
  });

  child.on("exit", (code, signal) => {
    if (code !== 0) {
      const error = new Error(
        "Worker exited abnormally: " +
        JSON.stringify({ code, signal, stderr })
      );
      rejectReady(error);
      rejectDone(error);
    }
  });

  return { child, ready, done, messages };
}

test("two independent processes cannot prepare separate TxIDs", async t => {
  const dir = mkdtempSync(
    join(tmpdir(), "nexusmed-m15-race-")
  );

  const path = join(dir, "synthetic.sqlite");
  const workers = [];

  t.after(() => {
    for (const worker of workers) {
      if (!worker.child.killed) {
        worker.child.kill();
      }
    }

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
  } finally {
    db.close();
  }

  workers.push(
    createWorker(path, TXIDS[0]),
    createWorker(path, TXIDS[1])
  );

  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("MULTIPROCESS_TIMEOUT")),
      10000
    );
    t.after(() => clearTimeout(timer));
  });

  await Promise.race([
    Promise.all(workers.map(w => w.ready)),
    timeout,
  ]);

  assert.equal(
    workers.every(w =>
      w.messages.some(m => m.type === "ready")
    ),
    true
  );

  // Release both workers after both observed
  // an eligible candidate path.
  for (const worker of workers) {
    worker.child.send({ type: "go" });
  }

  const outcomes = await Promise.race([
    Promise.all(workers.map(w => w.done)),
    timeout,
  ]);

  assert.equal(
    outcomes.filter(v => v === "prepared").length,
    1
  );

  assert.equal(
    outcomes.filter(v => v === "rejected").length,
    1
  );

  const verify = open(path);

  try {
    const saved = findFabricSubmissionV3(
      verify,
      REF
    );

    assert.equal(saved.status, "prepared");
    assert.ok(TXIDS.includes(saved.transaction_id));

    const row = verify.prepare(`
      SELECT COUNT(*) AS total
      FROM fabric_submission_journal_v3
      WHERE referral_id = ?
    `).get(REF);

    assert.equal(row.total, 1);

    const downgrade = decideFabricJournalPathV3({
      db: verify,
      referralId: REF,
      mode: "disabled",
    });

    assert.equal(downgrade.path, "blocked");
    assert.equal(downgrade.allowFabricRetry, false);
    assert.equal(downgrade.allowRegistryCommit, false);
  } finally {
    verify.close();
  }
});
