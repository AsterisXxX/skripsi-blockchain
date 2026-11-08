import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  canReceiveReferral,
} from "../src/services/referralAuthorizationService.js";

function fixture() {
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

    INSERT INTO institutions VALUES
      ('fktp-a', 'approved', 0),
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
      ('inactive', 'fkrtl-x', 'disabled'),
      ('sender', 'fktp-a', 'active');

    INSERT INTO role_assignments VALUES
      ('doctor-a', 'referral_receiver', NULL),
      ('doctor-b', 'referral_receiver', NULL),
      ('doctor-y', 'referral_receiver', NULL),
      ('inactive', 'referral_receiver', NULL),
      ('sender', 'referral_sender', NULL);

    INSERT INTO user_department_assignments VALUES
      ('doctor-a', 'jantung-x', NULL),
      ('doctor-b', 'saraf-x', NULL),
      ('doctor-y', 'jantung-y', NULL),
      ('inactive', 'jantung-x', NULL);
  `);

  return db;
}

const referral = {
  receiverInstitutionId: "fkrtl-x",
  targetDepartmentId: "jantung-x",
};

test("authorized specialist can receive referral", () => {
  const db = fixture();
  try {
    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-a",
        ...referral,
      }),
      true,
    );
  } finally {
    db.close();
  }
});

test("different department is denied", () => {
  const db = fixture();
  try {
    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-b",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("different institution is denied", () => {
  const db = fixture();
  try {
    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-y",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("disabled user is denied", () => {
  const db = fixture();
  try {
    assert.equal(
      canReceiveReferral(db, {
        userId: "inactive",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("sender role cannot receive referral", () => {
  const db = fixture();
  try {
    assert.equal(
      canReceiveReferral(db, {
        userId: "sender",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("revoked department membership is denied", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE user_department_assignments
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = 'doctor-a'
    `).run();

    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-a",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("revoked receiver role is denied", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE role_assignments
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = 'doctor-a'
    `).run();

    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-a",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("inactive destination department is denied", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE departments
      SET status = 'inactive'
      WHERE id = 'jantung-x'
    `).run();

    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-a",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("suspended institution is denied", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE institutions
      SET status = 'suspended'
      WHERE id = 'fkrtl-x'
    `).run();

    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-a",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("missing identities fail closed", () => {
  const db = fixture();
  try {
    assert.equal(
      canReceiveReferral(db, {
        userId: "",
        ...referral,
      }),
      false,
    );

    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-a",
        receiverInstitutionId: "fkrtl-x",
        targetDepartmentId: "",
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test("a user with no matching role is denied", () => {
  const db = fixture();
  try {
    db.prepare(`
      DELETE FROM role_assignments
      WHERE user_id = 'doctor-a'
    `).run();

    assert.equal(
      canReceiveReferral(db, {
        userId: "doctor-a",
        ...referral,
      }),
      false,
    );
  } finally {
    db.close();
  }
});
