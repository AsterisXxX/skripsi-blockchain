import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  migrateFabricSubmissionJournalV3,
} from "../src/services/fabricSubmissionJournalMigrationV3.js";

import {
  prepareFabricSubmissionV3,
  findFabricSubmissionV3,
} from "../src/services/fabricSubmissionJournalV3.js";

import {
  decideFabricJournalPathV3,
} from "../src/services/fabricJournalDowngradeGuardV3.js";

const REF = "REF-CRASH-059";
const HASH = "a".repeat(64);
const TXID = "b".repeat(64);
const TXID2 = "c".repeat(64);
const TIME = "2026-11-19T16:00:00.000Z";

function open(path) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 1000");
  return db;
}

function fixture(t) {
  const dir = mkdtempSync(
    join(tmpdir(), "nexusmed-m15-059-")
  );

  const path = join(dir, "synthetic.sqlite");

  t.after(() => {
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  });

  const db = open(path);

  db.exec(`
    CREATE TABLE referral_registry (
      referral_id TEXT PRIMARY KEY,
      document_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      fabric_transaction_id TEXT
    );
  `);

  db.prepare(`
    INSERT INTO referral_registry (
      referral_id,
      document_hash,
      status
    ) VALUES (?, ?, 'pending_ledger')
  `).run(REF, HASH);

  migrateFabricSubmissionJournalV3(db);
  db.close();

  return path;
}

function prepare(db, transactionId = TXID) {
  return prepareFabricSubmissionV3(db, {
    referralId: REF,
    transactionId,
    documentHash: HASH,
    timestamp: TIME,
  });
}

test("prepared journal survives connection reopen", t => {
  const path = fixture(t);

  const first = open(path);
  try {
    prepare(first);
  } finally {
    first.close();
  }

  const second = open(path);
  try {
    const saved = findFabricSubmissionV3(
      second,
      REF
    );

    assert.equal(saved.transaction_id, TXID);
    assert.equal(saved.status, "prepared");
    assert.equal(saved.document_hash, HASH);
  } finally {
    second.close();
  }
});

test("abrupt child process exit preserves prepared journal", t => {
  const path = fixture(t);

  const script = `
    import Database from "better-sqlite3";
    import { resolve } from "node:path";
    import { pathToFileURL } from "node:url";

    const moduleUrl = pathToFileURL(
      resolve(
        "src/services/fabricSubmissionJournalV3.js"
      )
    ).href;

    const { prepareFabricSubmissionV3 } =
      await import(moduleUrl);

    const db = new Database(process.argv[1]);
    db.pragma("foreign_keys = ON");

    prepareFabricSubmissionV3(db, {
      referralId: "${REF}",
      transactionId: "${TXID}",
      documentHash: "${HASH}",
      timestamp: "${TIME}",
    });

    // Exit without db.close() to simulate
    // abrupt termination after durable prepare.
    process.exit(73);
  `;

  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, path],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10000,
    }
  );

  assert.equal(
    child.error,
    undefined,
    "Synthetic child process failed to launch"
  );

  assert.equal(
    child.status,
    73,
    "Child did not reach the intentional abrupt exit"
  );

  const db = open(path);
  try {
    const saved = findFabricSubmissionV3(
      db,
      REF
    );

    assert.equal(saved.transaction_id, TXID);
    assert.equal(saved.status, "prepared");

    const decision = decideFabricJournalPathV3({
      db,
      referralId: REF,
      mode: "disabled",
    });

    assert.equal(decision.path, "blocked");
    assert.equal(decision.allowFabricRetry, false);
    assert.equal(decision.allowRegistryCommit, false);
  } finally {
    db.close();
  }
});

test("two SQLite connections cannot prepare duplicate attempt", t => {
  const path = fixture(t);

  const a = open(path);
  const b = open(path);

  try {
    // Both connections observe a candidate
    // before either one prepares the journal.
    const initialA = decideFabricJournalPathV3({
      db: a,
      referralId: REF,
      mode: "prepare_only",
    });

    const initialB = decideFabricJournalPathV3({
      db: b,
      referralId: REF,
      mode: "prepare_only",
    });

    assert.equal(initialA.path, "journal_candidate");
    assert.equal(initialB.path, "journal_candidate");

    prepare(a, TXID);

    // Connection B has a stale decision.
    // The database must reject another insert.
    assert.throws(
      () => prepare(b, TXID2)
    );

    const saved = findFabricSubmissionV3(b, REF);

    assert.equal(saved.transaction_id, TXID);

    const count = b.prepare(`
      SELECT COUNT(*) AS total
      FROM fabric_submission_journal_v3
      WHERE referral_id = ?
    `).get(REF);

    assert.equal(count.total, 1);
  } finally {
    a.close();
    b.close();
  }
});

test("immutable triggers survive reopen", t => {
  const path = fixture(t);

  const first = open(path);
  try {
    prepare(first);
  } finally {
    first.close();
  }

  const db = open(path);

  try {
    assert.throws(() => {
      db.prepare(`
        UPDATE fabric_submission_journal_v3
        SET status = 'prepared'
        WHERE referral_id = ?
      `).run(REF);
    });

    assert.throws(() => {
      db.prepare(`
        DELETE FROM fabric_submission_journal_v3
        WHERE referral_id = ?
      `).run(REF);
    });

    assert.equal(
      findFabricSubmissionV3(db, REF).transaction_id,
      TXID
    );
  } finally {
    db.close();
  }
});
