import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  assignDepartmentMembership,
  revokeDepartmentMembership,
  DepartmentMembershipError,
} from "../src/services/departmentMembershipService.js";

import {
  canReceiveReferral,
} from "../src/services/referralAuthorizationService.js";

const IDs = {
  admin: "00000000-0000-4000-8000-000000000001",
  staff: "00000000-0000-4000-8000-000000000002",
  foreign: "00000000-0000-4000-8000-000000000003",
  inactive: "00000000-0000-4000-8000-000000000004",
  noRole: "00000000-0000-4000-8000-000000000005",
  nonAdmin: "00000000-0000-4000-8000-000000000006",
};

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
      username TEXT NOT NULL,
      institution_id TEXT,
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
      status TEXT NOT NULL
    );

    CREATE TABLE user_department_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE UNIQUE INDEX idx_active_user_department
      ON user_department_assignments(user_id, department_id)
      WHERE revoked_at IS NULL;

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
      ('org2', 'approved', 1),
      ('org3', 'approved', 1);

    INSERT INTO departments VALUES
      ('poli_umum_org2', 'org2', 'Poli Umum', 'active'),
      ('poli_jantung_org2', 'org2', 'Poli Jantung', 'active'),
      ('poli_inactive_org2', 'org2', 'Poli Nonaktif', 'inactive'),
      ('poli_umum_org3', 'org3', 'Poli Umum', 'active');
  `);

  const addUser = db.prepare(`
    INSERT INTO users (id, username, institution_id, status)
    VALUES (?, ?, ?, ?)
  `);

  addUser.run(IDs.admin, "nexusadmin", null, "active");
  addUser.run(IDs.staff, "staff_org2", "org2", "active");
  addUser.run(IDs.foreign, "staff_org3", "org3", "active");
  addUser.run(IDs.inactive, "inactive_staff", "org2", "disabled");
  addUser.run(IDs.noRole, "staff_no_role", "org2", "active");
  addUser.run(IDs.nonAdmin, "ordinary_user", "org2", "active");

  const addRole = db.prepare(`
    INSERT INTO role_assignments (user_id, role, revoked_at)
    VALUES (?, ?, NULL)
  `);

  addRole.run(IDs.admin, "consortium_admin");
  addRole.run(IDs.staff, "referral_receiver");
  addRole.run(IDs.foreign, "referral_receiver");
  addRole.run(IDs.inactive, "referral_receiver");
  addRole.run(IDs.nonAdmin, "referral_receiver");

  return db;
}

function assign(db, overrides = {}) {
  return assignDepartmentMembership(db, {
    userId: IDs.staff,
    departmentId: "poli_jantung_org2",
    actorUserId: IDs.admin,
    ...overrides,
  });
}

function count(db, table) {
  const permitted = [
    "user_department_assignments",
    "audit_logs",
  ];

  assert.ok(permitted.includes(table));

  return db.prepare(
    `SELECT COUNT(*) AS n FROM ${table}`
  ).get().n;
}

function expectError(fn, statusCode) {
  assert.throws(fn, error =>
    error instanceof DepartmentMembershipError &&
    error.statusCode === statusCode
  );
}

test("assign creates membership and audit atomically", () => {
  const db = fixture();

  try {
    const result = assign(db);

    assert.equal(result.status, "success");
    assert.equal(result.membership.active, true);
    assert.equal(count(db, "user_department_assignments"), 1);
    assert.equal(count(db, "audit_logs"), 1);

    const audit = db.prepare(`
      SELECT action, actor_user_id, target_id, result
      FROM audit_logs
    `).get();

    assert.equal(audit.action, "ASSIGN_DEPARTMENT_MEMBERSHIP");
    assert.equal(audit.actor_user_id, IDs.admin);
    assert.equal(audit.target_id, result.membership.id);
    assert.equal(audit.result, "success");
  } finally {
    db.close();
  }
});

test("duplicate active assignment returns 409", () => {
  const db = fixture();

  try {
    assign(db);
    expectError(() => assign(db), 409);

    assert.equal(count(db, "user_department_assignments"), 1);
    assert.equal(count(db, "audit_logs"), 1);
  } finally {
    db.close();
  }
});

test("cross-institution assignment is denied", () => {
  const db = fixture();

  try {
    expectError(
      () => assign(db, { userId: IDs.foreign }),
      403
    );

    assert.equal(count(db, "user_department_assignments"), 0);
    assert.equal(count(db, "audit_logs"), 0);
  } finally {
    db.close();
  }
});

test("inactive user and inactive department are denied", () => {
  const db = fixture();

  try {
    expectError(
      () => assign(db, { userId: IDs.inactive }),
      403
    );

    expectError(
      () => assign(db, {
        departmentId: "poli_inactive_org2"
      }),
      403
    );

    assert.equal(count(db, "user_department_assignments"), 0);
  } finally {
    db.close();
  }
});

test("missing receiver role is denied", () => {
  const db = fixture();

  try {
    expectError(
      () => assign(db, { userId: IDs.noRole }),
      403
    );

    assert.equal(count(db, "user_department_assignments"), 0);
  } finally {
    db.close();
  }
});

test("non-admin cannot assign or revoke", () => {
  const db = fixture();

  try {
    expectError(
      () => assign(db, { actorUserId: IDs.nonAdmin }),
      403
    );

    const result = assign(db);

    expectError(
      () => revokeDepartmentMembership(db, {
        assignmentId: result.membership.id,
        actorUserId: IDs.nonAdmin,
      }),
      403
    );

    const membership = db.prepare(`
      SELECT revoked_at
      FROM user_department_assignments
      WHERE id = ?
    `).get(result.membership.id);

    assert.equal(membership.revoked_at, null);
    assert.equal(count(db, "audit_logs"), 1);
  } finally {
    db.close();
  }
});

test("revoke denies subsequent referral access", () => {
  const db = fixture();

  try {
    const assignment = assign(db);

    const referral = {
      userId: IDs.staff,
      receiverInstitutionId: "org2",
      targetDepartmentId: "poli_jantung_org2",
    };

    assert.equal(canReceiveReferral(db, referral), true);

    const revoked = revokeDepartmentMembership(db, {
      assignmentId: assignment.membership.id,
      actorUserId: IDs.admin,
    });

    assert.equal(revoked.membership.active, false);
    assert.equal(canReceiveReferral(db, referral), false);

    const audit = db.prepare(`
      SELECT action, result
      FROM audit_logs
      ORDER BY rowid DESC
      LIMIT 1
    `).get();

    assert.equal(audit.action, "REVOKE_DEPARTMENT_MEMBERSHIP");
    assert.equal(audit.result, "success");
    assert.equal(count(db, "audit_logs"), 2);
  } finally {
    db.close();
  }
});

test("repeated revoke returns 409 without extra audit", () => {
  const db = fixture();

  try {
    const assignment = assign(db);

    const input = {
      assignmentId: assignment.membership.id,
      actorUserId: IDs.admin,
    };

    revokeDepartmentMembership(db, input);

    expectError(
      () => revokeDepartmentMembership(db, input),
      409
    );

    assert.equal(count(db, "audit_logs"), 2);
  } finally {
    db.close();
  }
});

test("assign rolls back if audit insertion fails", () => {
  const db = fixture();

  try {
    db.exec(`
      CREATE TRIGGER block_membership_audit
      BEFORE INSERT ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'AUDIT_BLOCKED');
      END;
    `);

    assert.throws(
      () => assign(db),
      /AUDIT_BLOCKED/
    );

    assert.equal(count(db, "user_department_assignments"), 0);
    assert.equal(count(db, "audit_logs"), 0);
  } finally {
    db.close();
  }
});

test("revoke rolls back if audit insertion fails", () => {
  const db = fixture();

  try {
    const assignment = assign(db);

    db.exec(`
      CREATE TRIGGER block_revoke_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'REVOKE_DEPARTMENT_MEMBERSHIP'
      BEGIN
        SELECT RAISE(ABORT, 'AUDIT_BLOCKED');
      END;
    `);

    assert.throws(
      () => revokeDepartmentMembership(db, {
        assignmentId: assignment.membership.id,
        actorUserId: IDs.admin,
      }),
      /AUDIT_BLOCKED/
    );

    const membership = db.prepare(`
      SELECT revoked_at
      FROM user_department_assignments
      WHERE id = ?
    `).get(assignment.membership.id);

    assert.equal(membership.revoked_at, null);
    assert.equal(count(db, "audit_logs"), 1);
  } finally {
    db.close();
  }
});

test("previously revoked membership can be reassigned", () => {
  const db = fixture();

  try {
    const first = assign(db);

    revokeDepartmentMembership(db, {
      assignmentId: first.membership.id,
      actorUserId: IDs.admin,
    });

    const second = assign(db);

    assert.notEqual(first.membership.id, second.membership.id);

    const active = db.prepare(`
      SELECT COUNT(*) AS n
      FROM user_department_assignments
      WHERE revoked_at IS NULL
    `).get().n;

    assert.equal(active, 1);
    assert.equal(count(db, "user_department_assignments"), 2);
    assert.equal(count(db, "audit_logs"), 3);
  } finally {
    db.close();
  }
});
