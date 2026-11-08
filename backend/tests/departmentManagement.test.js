import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  registerDepartment,
  DepartmentManagementError,
} from "../src/services/departmentManagementService.js";

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
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (institution_id) REFERENCES institutions(id)
    );

    CREATE TABLE user_department_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details TEXT,
      result TEXT NOT NULL
    );

    INSERT INTO institutions VALUES
      ('org1', 'approved', 0),
      ('org2', 'approved', 1),
      ('org3', 'suspended', 1);

    INSERT INTO users VALUES
      ('admin', 'active'),
      ('staff', 'active');

    INSERT INTO role_assignments VALUES
      ('admin', 'consortium_admin', NULL),
      ('staff', 'referral_receiver', NULL);

    INSERT INTO departments VALUES
      ('poli_umum_org2', 'org2', 'Poli Umum', 'active');
  `);

  return db;
}

const proposed = {
  id: "poli_jantung_org2",
  name: "Poli Jantung",
  institutionId: "org2",
  actorUserId: "admin"
};

test("admin registers a department with an audit record", () => {
  const db = fixture();
  try {
    const result = registerDepartment(db, proposed);

    assert.equal(result.status, "success");
    assert.equal(result.department.status, "active");

    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS n FROM departments"
      ).get().n,
      2
    );

    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs"
      ).get().n,
      1
    );
  } finally {
    db.close();
  }
});

test("registration does not grant any staff membership", () => {
  const db = fixture();
  try {
    registerDepartment(db, proposed);

    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS n
        FROM user_department_assignments
      `).get().n,
      0
    );
  } finally {
    db.close();
  }
});

test("duplicate ID and duplicate name are rejected", () => {
  const db = fixture();
  try {
    registerDepartment(db, proposed);

    assert.throws(
      () => registerDepartment(db, proposed),
      error =>
        error instanceof DepartmentManagementError &&
        error.statusCode === 409
    );

    assert.throws(
      () => registerDepartment(db, {
        ...proposed,
        id: "poli_jantung_duplikat_org2",
      }),
      error => error.statusCode === 409
    );
  } finally {
    db.close();
  }
});

test("sender and suspended institution are rejected", () => {
  const db = fixture();
  try {
    assert.throws(
      () => registerDepartment(db, {
        ...proposed,
        institutionId: "org1"
      }),
      error => error.statusCode === 403
    );

    assert.throws(
      () => registerDepartment(db, {
        ...proposed,
        institutionId: "org3"
      }),
      error => error.statusCode === 403
    );
  } finally {
    db.close();
  }
});

test("non-admin cannot register departments", () => {
  const db = fixture();
  try {
    assert.throws(
      () => registerDepartment(db, {
        ...proposed,
        actorUserId: "staff"
      }),
      error => error.statusCode === 403
    );

    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS n FROM audit_logs"
      ).get().n,
      0
    );
  } finally {
    db.close();
  }
});

test("audit failure rolls back department insertion", () => {
  const db = fixture();
  try {
    db.exec(`
      CREATE TRIGGER block_department_audit
      BEFORE INSERT ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'simulated audit failure');
      END;
    `);

    assert.throws(
      () => registerDepartment(db, proposed),
      /simulated audit failure/
    );

    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS n
        FROM departments
        WHERE id = 'poli_jantung_org2'
      `).get().n,
      0
    );
  } finally {
    db.close();
  }
});
