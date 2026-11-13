import test, { mock } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";

const src = new URL("../src/", import.meta.url);

const ADMIN = "00000000-0000-4000-8000-000000000001";
const STAFF = "00000000-0000-4000-8000-000000000002";
const FOREIGN = "00000000-0000-4000-8000-000000000003";
const NO_ROLE = "00000000-0000-4000-8000-000000000004";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE institutions (
    id TEXT PRIMARY KEY,
    name TEXT,
    msp_id TEXT,
    status TEXT NOT NULL,
    can_send INTEGER NOT NULL DEFAULT 0,
    can_receive INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    institution_id TEXT,
    status TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE role_assignments (
    id TEXT PRIMARY KEY,
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
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO institutions
    (id, name, msp_id, status, can_receive)
  VALUES
    ('org2', 'FKRTL Penerima', 'Org2MSP', 'approved', 1),
    ('org3', 'FKRTL Lain', 'Org3MSP', 'approved', 1);

  INSERT INTO departments VALUES
    ('poli_umum_org2', 'org2', 'Poli Umum', 'active'),
    ('poli_jantung_org2', 'org2', 'Poli Jantung', 'active'),
    ('poli_umum_org3', 'org3', 'Poli Umum', 'active');

  INSERT INTO users
    (id, username, institution_id, status)
  VALUES
    ('${ADMIN}', 'nexusadmin', NULL, 'active'),
    ('${STAFF}', 'staff_org2', 'org2', 'active'),
    ('${FOREIGN}', 'staff_org3', 'org3', 'active'),
    ('${NO_ROLE}', 'staff_no_role', 'org2', 'active');

  INSERT INTO role_assignments
    (id, user_id, role, revoked_at)
  VALUES
    ('role-admin', '${ADMIN}', 'consortium_admin', NULL),
    ('role-staff', '${STAFF}', 'referral_receiver', NULL),
    ('role-foreign', '${FOREIGN}', 'referral_receiver', NULL);
`);

mock.module(
  new URL("config/database.js", src).href,
  { defaultExport: db }
);

mock.module(
  new URL("services/adminAuthService.js", src).href,
  {
    namedExports: {
      authenticateAdmin(username, password) {
        if (
          username !== "nexusadmin" ||
          password !== "isolated-test-only"
        ) {
          return null;
        }

        return {
          id: ADMIN,
          username,
          role: "consortium_admin",
          sessionVersion: 1,
        };
      },
    },
  }
);

mock.module(
  new URL("services/staffAuthService.js", src).href,
  {
    namedExports: {
      authenticateStaff() {
        return null;
      },
    },
  }
);

// IMPORTANT: dynamic imports happen AFTER database mock registration.
const { login } = await import(
  new URL("middleware/auth.js", src).href
);

const { default: adminRoutes } = await import(
  new URL("routes/adminRoutes.js", src).href
);

const { canReceiveReferral } = await import(
  new URL("services/referralAuthorizationService.js", src).href
);

test("M14 membership: HTTP assign/revoke and audit", async () => {
  const app = express();
  app.use(express.json());

  app.post("/api/test-login", login);
  app.use("/api/admin", adminRoutes);

  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise(resolve => {
      if (server.listening) resolve();
      else server.once("listening", resolve);
    });

    const base =
      `http://127.0.0.1:${server.address().port}`;

    const loginResponse = await fetch(
      `${base}/api/test-login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "nexusadmin",
          password: "isolated-test-only",
        }),
      }
    );

    assert.equal(loginResponse.status, 200);

    const setCookie =
      loginResponse.headers.get("set-cookie");

    assert.ok(setCookie?.includes("nexusmed_session="));

    const cookie = setCookie.split(";")[0];

    async function request(
      method,
      path,
      payload,
      authenticated = true
    ) {
      return fetch(`${base}/api/admin${path}`, {
        method,
        headers: {
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(authenticated ? { cookie } : {}),
        },
        ...(payload === undefined
          ? {}
          : { body: JSON.stringify(payload) }),
      });
    }

    const membershipPath = "/department-memberships";

    const validInput = {
      userId: STAFF,
      departmentId: "poli_jantung_org2",
    };

    console.log("\n=== HTTP AUTHORIZATION ===");

    const anonymous = await request(
      "POST",
      membershipPath,
      validInput,
      false
    );

    assert.equal(anonymous.status, 401);

    console.log("Anonymous POST: 401 PASS");

    console.log("\n=== HTTP ASSIGN ===");

    const created = await request(
      "POST",
      membershipPath,
      validInput
    );

    assert.equal(created.status, 201);

    const createdBody = await created.json();

    assert.equal(createdBody.status, "success");
    assert.equal(createdBody.membership.user_id, STAFF);
    assert.equal(
      createdBody.membership.department_id,
      "poli_jantung_org2"
    );

    const assignmentId = createdBody.membership.id;

    const stored = db.prepare(`
      SELECT id, user_id, department_id, revoked_at
      FROM user_department_assignments
      WHERE id = ?
    `).get(assignmentId);

    assert.equal(stored.user_id, STAFF);
    assert.equal(stored.revoked_at, null);

    assert.equal(
      canReceiveReferral(db, {
        userId: STAFF,
        receiverInstitutionId: "org2",
        targetDepartmentId: "poli_jantung_org2",
      }),
      true
    );

    console.log("Authenticated POST: 201 PASS");
    console.log("Effective authorization: ALLOWED");

    console.log("\n=== HTTP NEGATIVE CASES ===");

    const duplicate = await request(
      "POST",
      membershipPath,
      validInput
    );

    assert.equal(duplicate.status, 409);

    const crossInstitution = await request(
      "POST",
      membershipPath,
      {
        userId: FOREIGN,
        departmentId: "poli_jantung_org2",
      }
    );

    assert.equal(crossInstitution.status, 403);

    const missingRole = await request(
      "POST",
      membershipPath,
      {
        userId: NO_ROLE,
        departmentId: "poli_jantung_org2",
      }
    );

    assert.equal(missingRole.status, 403);

    const invalid = await request(
      "POST",
      membershipPath,
      {
        userId: "invalid",
        departmentId: "poli_jantung_org2",
      }
    );

    assert.equal(invalid.status, 400);

    const missingUser = await request(
      "POST",
      membershipPath,
      {
        userId: "00000000-0000-4000-8000-000000000099",
        departmentId: "poli_jantung_org2",
      }
    );

    assert.equal(missingUser.status, 404);

    const missingDepartment = await request(
      "POST",
      membershipPath,
      {
        userId: STAFF,
        departmentId: "poli_tidak_ada",
      }
    );

    assert.equal(missingDepartment.status, 404);

    console.log("Duplicate: 409 PASS");
    console.log("Cross-institution: 403 PASS");
    console.log("Missing role: 403 PASS");
    console.log("Invalid ID: 400 PASS");
    console.log("Missing user: 404 PASS");
    console.log("Missing department: 404 PASS");

    console.log("\n=== HTTP READ ===");

    const listed = await request(
      "GET",
      membershipPath
    );

    assert.equal(listed.status, 200);

    const listBody = await listed.json();

    assert.equal(listBody.total, 1);
    assert.equal(listBody.memberships[0].assignment_id, assignmentId);

    console.log("GET membership list: 200 PASS");

    console.log("\n=== HTTP REVOKE ===");

    const revokePath =
      `${membershipPath}/${assignmentId}/revoke`;

    const revoked = await request(
      "PATCH",
      revokePath
    );

    assert.equal(revoked.status, 200);

    const revokedBody = await revoked.json();

    assert.equal(revokedBody.membership.active, false);

    assert.equal(
      canReceiveReferral(db, {
        userId: STAFF,
        receiverInstitutionId: "org2",
        targetDepartmentId: "poli_jantung_org2",
      }),
      false
    );

    const revokedRow = db.prepare(`
      SELECT revoked_at
      FROM user_department_assignments
      WHERE id = ?
    `).get(assignmentId);

    assert.ok(revokedRow.revoked_at);

    const repeated = await request(
      "PATCH",
      revokePath
    );

    assert.equal(repeated.status, 409);

    const missingAssignment = await request(
      "PATCH",
      `${membershipPath}/00000000-0000-4000-8000-000000000099/revoke`
    );

    assert.equal(missingAssignment.status, 404);

    const invalidAssignment = await request(
      "PATCH",
      `${membershipPath}/invalid/revoke`
    );

    assert.equal(invalidAssignment.status, 400);

    console.log("Revoke: 200 PASS");
    console.log("Authorization after revoke: DENIED");
    console.log("Repeated revoke: 409 PASS");
    console.log("Missing assignment: 404 PASS");
    console.log("Invalid assignment: 400 PASS");

    console.log("\n=== ATOMIC AUDIT VERIFICATION ===");

    const audits = db.prepare(`
      SELECT action, actor_user_id, target_id, result
      FROM audit_logs
      ORDER BY rowid
    `).all();

    assert.equal(audits.length, 2);

    assert.deepEqual(
      audits.map(item => item.action),
      [
        "ASSIGN_DEPARTMENT_MEMBERSHIP",
        "REVOKE_DEPARTMENT_MEMBERSHIP",
      ]
    );

    for (const audit of audits) {
      assert.equal(audit.actor_user_id, ADMIN);
      assert.equal(audit.target_id, assignmentId);
      assert.equal(audit.result, "success");
    }

    console.table(audits);

    console.log("\n=== AUDIT FAILURE ROLLBACK ===");

    db.exec(`
      CREATE TRIGGER block_assign_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'ASSIGN_DEPARTMENT_MEMBERSHIP'
      BEGIN
        SELECT RAISE(ABORT, 'AUDIT_BLOCKED');
      END;
    `);

    const before = db.prepare(`
      SELECT COUNT(*) AS n
      FROM user_department_assignments
    `).get().n;

    const failedAudit = await request(
      "POST",
      membershipPath,
      {
        userId: STAFF,
        departmentId: "poli_umum_org2",
      }
    );

    assert.equal(failedAudit.status, 500);

    const after = db.prepare(`
      SELECT COUNT(*) AS n
      FROM user_department_assignments
    `).get().n;

    assert.equal(before, after);

    const auditCount = db.prepare(`
      SELECT COUNT(*) AS n FROM audit_logs
    `).get().n;

    assert.equal(auditCount, 2);

    console.log("Audit failure HTTP 500: PASS");
    console.log("Assignment rollback: PASS");
    console.log("No partial membership persisted: PASS");

    console.log("\n=== M14 HTTP MEMBERSHIP TEST PASS ===");
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error =>
        error ? reject(error) : resolve()
      );
    });

    db.close();
  }
});
