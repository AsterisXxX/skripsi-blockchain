import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  findDepartments,
  findDepartmentMemberships,
} from "../src/repositories/departmentReadRepository.js";

function fixture() {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE institutions (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT,
      can_receive INTEGER
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT,
      institution_id TEXT,
      status TEXT
    );

    CREATE TABLE role_assignments (
      user_id TEXT,
      role TEXT,
      revoked_at TEXT
    );

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      institution_id TEXT,
      name TEXT,
      status TEXT
    );

    CREATE TABLE user_department_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      department_id TEXT,
      assigned_at TEXT,
      revoked_at TEXT
    );

    INSERT INTO institutions VALUES
      ('org2', 'FKRTL Uji', 'approved', 1),
      ('org3', 'FKRTL Lain', 'approved', 1);

    INSERT INTO users VALUES
      ('doctor-a', 'doctor_a', 'org2', 'active'),
      ('doctor-b', 'doctor_b', 'org2', 'active'),
      ('doctor-c', 'doctor_c', 'org3', 'active');

    INSERT INTO role_assignments VALUES
      ('doctor-a', 'referral_receiver', NULL),
      ('doctor-b', 'referral_sender', NULL),
      ('doctor-c', 'referral_receiver', NULL);

    INSERT INTO departments VALUES
      ('umum', 'org2', 'Poli Umum', 'active'),
      ('jantung', 'org2', 'Poli Jantung', 'active'),
      ('anak', 'org2', 'Poli Anak', 'inactive');

    INSERT INTO user_department_assignments VALUES
      ('a-umum', 'doctor-a', 'umum', '2026-11-09', NULL),
      ('a-anak', 'doctor-a', 'anak', '2026-11-09', NULL),
      ('b-jantung', 'doctor-b', 'jantung', '2026-11-09', NULL),
      ('revoked', 'doctor-a', 'jantung', '2026-11-09', '2026-11-09'),
      ('cross-org', 'doctor-c', 'umum', '2026-11-09', NULL);
  `);

  return db;
}

test("department list includes active and inactive poli", () => {
  const db = fixture();
  try {
    const rows = findDepartments(db);
    assert.equal(rows.length, 3);
    assert.ok(rows.some(row =>
      row.id === "anak" && row.status === "inactive"
    ));
  } finally {
    db.close();
  }
});

test("only active same-institution assignments are listed", () => {
  const db = fixture();
  try {
    const rows = findDepartmentMemberships(db);
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row =>
      row.assignment_id !== "revoked" &&
      row.assignment_id !== "cross-org"
    ));
  } finally {
    db.close();
  }
});

test("effective receiver permission checks role and department", () => {
  const db = fixture();
  try {
    const rows = findDepartmentMemberships(db);
    const byId = Object.fromEntries(
      rows.map(row => [row.assignment_id, row])
    );

    assert.equal(byId["a-umum"].can_receive_referral, 1);
    assert.equal(byId["a-anak"].can_receive_referral, 0);
    assert.equal(byId["b-jantung"].can_receive_referral, 0);
    assert.equal(byId["a-umum"].roles, "referral_receiver");
  } finally {
    db.close();
  }
});
