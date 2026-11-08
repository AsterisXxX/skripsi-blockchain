import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";

import {
  createReferralAccessGuard,
} from "../src/middleware/referralAccess.js";

function createFixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE institutions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      can_receive INTEGER NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE role_assignments (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE user_department_assignments (
      user_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE referral_registry (
      referral_id TEXT PRIMARY KEY,
      sender_institution_id TEXT NOT NULL,
      receiver_institution_id TEXT NOT NULL,
      target_department_id TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      fabric_transaction_id TEXT
    );

    INSERT INTO institutions VALUES
      ('fkrtl-x', 'approved', 1),
      ('fkrtl-y', 'approved', 1);

    INSERT INTO departments VALUES
      ('jantung-x', 'fkrtl-x', 'active'),
      ('saraf-x', 'fkrtl-x', 'active'),
      ('jantung-y', 'fkrtl-y', 'active');

    INSERT INTO users VALUES
      ('doctor-a', 'fkrtl-x', 'active'),
      ('doctor-b', 'fkrtl-x', 'active'),
      ('doctor-y', 'fkrtl-y', 'active'),
      ('disabled', 'fkrtl-x', 'disabled');

    INSERT INTO role_assignments VALUES
      ('doctor-a', 'referral_receiver', NULL),
      ('doctor-b', 'referral_receiver', NULL),
      ('doctor-y', 'referral_receiver', NULL),
      ('disabled', 'referral_receiver', NULL);

    INSERT INTO user_department_assignments VALUES
      ('doctor-a', 'jantung-x', NULL),
      ('doctor-b', 'saraf-x', NULL),
      ('doctor-y', 'jantung-y', NULL),
      ('disabled', 'jantung-x', NULL);

    INSERT INTO referral_registry VALUES
      ('REF-001', 'fktp-a', 'fkrtl-x',
       'jantung-x', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       'committed', 'tx-001'),
      ('REF-PENDING', 'fktp-a', 'fkrtl-x',
       'jantung-x', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       'pending_ledger', NULL);
  `);

  return db;
}

async function runCase({ userId, referralId, mutate }) {
  const db = createFixture();
  let downstreamCalls = 0;

  try {
    if (mutate) mutate(db);

    const app = express();

    // Test-only session injection.
    // This is NOT a production authentication mechanism.
    app.use((req, res, next) => {
      if (userId) {
        req.user = { userId };
      }
      next();
    });

    app.get(
      "/api/referrals/:id/verified",
      createReferralAccessGuard(db),
      (req, res) => {
        downstreamCalls += 1;
        res.status(200).json({
          status: "downstream_reached",
          referralId: req.referralMetadata.referral_id,
        });
      },
    );

    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1");
      listener.once("listening", () => resolve(listener));
      listener.once("error", reject);
    });

    try {
      const { port } = server.address();
      const response = await fetch(
        `http://127.0.0.1:${port}/api/referrals/${encodeURIComponent(referralId)}/verified`,
      );

      return {
        status: response.status,
        body: await response.json(),
        downstreamCalls,
      };
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    db.close();
  }
}

const cases = [
  {
    name: "authorized receiving department",
    userId: "doctor-a",
    referralId: "REF-001",
    expected: 200,
    downstream: 1,
  },
  {
    name: "wrong department denied before downstream",
    userId: "doctor-b",
    referralId: "REF-001",
    expected: 403,
    downstream: 0,
  },
  {
    name: "wrong institution denied before downstream",
    userId: "doctor-y",
    referralId: "REF-001",
    expected: 403,
    downstream: 0,
  },
  {
    name: "disabled user denied",
    userId: "disabled",
    referralId: "REF-001",
    expected: 403,
    downstream: 0,
  },
  {
    name: "missing user denied",
    userId: null,
    referralId: "REF-001",
    expected: 403,
    downstream: 0,
  },
  {
    name: "missing referral denied",
    userId: "doctor-a",
    referralId: "REF-MISSING",
    expected: 404,
    downstream: 0,
  },
  {
    name: "uncommitted referral denied",
    userId: "doctor-a",
    referralId: "REF-PENDING",
    expected: 409,
    downstream: 0,
  },
  {
    name: "invalid referral ID rejected",
    userId: "doctor-a",
    referralId: "invalid.id",
    expected: 400,
    downstream: 0,
  },
  {
    name: "revoked department access denied immediately",
    userId: "doctor-a",
    referralId: "REF-001",
    expected: 403,
    downstream: 0,
    mutate(db) {
      db.prepare(`
        UPDATE user_department_assignments
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = 'doctor-a'
      `).run();
    },
  },
  {
    name: "revoked receiver role denied immediately",
    userId: "doctor-a",
    referralId: "REF-001",
    expected: 403,
    downstream: 0,
    mutate(db) {
      db.prepare(`
        UPDATE role_assignments
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = 'doctor-a'
      `).run();
    },
  },
];

for (const item of cases) {
  test(`HTTP: ${item.name}`, async () => {
    const result = await runCase(item);

    assert.equal(result.status, item.expected);
    assert.equal(result.downstreamCalls, item.downstream);
  });
}
