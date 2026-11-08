import test, { mock } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";

const src = new URL("../src/", import.meta.url);

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
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institution_id)
      REFERENCES institutions(id),
    UNIQUE (institution_id, id)
  );

  CREATE TABLE user_department_assignments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details TEXT,
    result TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO institutions
    (id, name, msp_id, status, can_send, can_receive)
  VALUES
    ('org1', 'FKTP', 'Org1MSP', 'approved', 1, 0),
    ('org2', 'FKRTL', 'Org2MSP', 'approved', 0, 1);

  INSERT INTO users
    (id, username, institution_id, status, session_version)
  VALUES
    ('admin-test', 'nexusadmin', NULL, 'active', 1);

  INSERT INTO role_assignments
    (id, user_id, role, revoked_at)
  VALUES
    ('role-admin', 'admin-test', 'consortium_admin', NULL);

  INSERT INTO departments
    (id, institution_id, name, status)
  VALUES
    ('poli_umum_org2', 'org2', 'Poli Umum', 'active');
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
          id: "admin-test",
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

const { login } = await import(
  new URL("middleware/auth.js", src).href
);

const { default: adminRoutes } = await import(
  new URL("routes/adminRoutes.js", src).href
);

test("M14 registration: real HTTP to SQLite transaction", async () => {
  const app = express();
  app.use(express.json());

  app.post("/api/test-login", login);
  app.use("/api/admin", adminRoutes);

  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => {
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

    async function register(payload, authenticated = true) {
      return fetch(`${base}/api/admin/departments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { cookie } : {}),
        },
        body: JSON.stringify(payload),
      });
    }

    const proposed = {
      id: "poli_jantung_org2",
      name: "Poli Jantung",
      institutionId: "org2",
    };

    // No session: controller must not be reached.
    const anonymous = await register(proposed, false);
    assert.equal(anonymous.status, 401);

    // Real controller + service + SQLite transaction.
    const created = await register(proposed);
    assert.equal(created.status, 201);

    const body = await created.json();
    assert.equal(body.status, "success");
    assert.equal(
      body.department.id,
      "poli_jantung_org2"
    );

    const department = db.prepare(`
      SELECT id, name, institution_id, status
      FROM departments
      WHERE id = ?
    `).get("poli_jantung_org2");

    assert.equal(department.name, "Poli Jantung");
    assert.equal(department.institution_id, "org2");
    assert.equal(department.status, "active");

    // Creating a department must NOT grant membership.
    const assignments = db.prepare(`
      SELECT COUNT(*) AS n
      FROM user_department_assignments
    `).get().n;

    assert.equal(assignments, 0);

    // Audit must exist for the successful write.
    const audit = db.prepare(`
      SELECT action, target_type, target_id, result
      FROM audit_logs
      WHERE target_id = ?
    `).get("poli_jantung_org2");

    assert.equal(audit.action, "CREATE_DEPARTMENT");
    assert.equal(audit.target_type, "department");
    assert.equal(audit.result, "success");

    // Duplicate must be rejected without extra audit.
    const duplicate = await register(proposed);
    assert.equal(duplicate.status, 409);

    // Sender institution cannot register receiving poli.
    const sender = await register({
      id: "poli_invalid_org1",
      name: "Poli Invalid",
      institutionId: "org1",
    });

    assert.equal(sender.status, 403);

    // Invalid department ID must be rejected.
    const invalid = await register({
      id: "../invalid",
      name: "Invalid",
      institutionId: "org2",
    });

    assert.equal(invalid.status, 400);

    const finalDepartments = db.prepare(`
      SELECT COUNT(*) AS n FROM departments
    `).get().n;

    const finalAudits = db.prepare(`
      SELECT COUNT(*) AS n FROM audit_logs
    `).get().n;

    assert.equal(finalDepartments, 2);
    assert.equal(finalAudits, 1);

    console.log(
      "PASS: HTTP 201, audit transaction, " +
      "no automatic membership, duplicate 409, " +
      "invalid institution 403, invalid ID 400"
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve()
      );
    });

    db.close();
  }
});
