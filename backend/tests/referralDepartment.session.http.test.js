import test, { mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE institutions (
    id TEXT PRIMARY KEY,
    msp_id TEXT,
    status TEXT NOT NULL,
    can_send INTEGER NOT NULL,
    can_receive INTEGER NOT NULL
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    institution_id TEXT,
    status TEXT NOT NULL,
    session_version INTEGER NOT NULL
  );

  CREATE TABLE role_assignments (
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE referral_registry (
    referral_id TEXT PRIMARY KEY,
    sender_institution_id TEXT,
    receiver_institution_id TEXT,
    target_department_id TEXT,
    document_hash TEXT,
    status TEXT,
    fabric_transaction_id TEXT
  );

  INSERT INTO institutions VALUES
    ('org1', 'Org1MSP', 'approved', 1, 0),
    ('org2', 'Org2MSP', 'approved', 0, 1);

  INSERT INTO users VALUES
    ('sender', 'org1', 'active', 1),
    ('receiver', 'org2', 'active', 1),
    ('admin', NULL, 'active', 1);

  INSERT INTO role_assignments VALUES
    ('sender', 'referral_sender', NULL),
    ('receiver', 'referral_receiver', NULL),
    ('admin', 'consortium_admin', NULL);

  INSERT INTO departments VALUES
    ('poli_anak_org2', 'Poli Anak', 'org2', 'active'),
    ('poli_jantung_org2', 'Poli Jantung', 'org2', 'active'),
    ('poli_penyakit_dalam_org2', 'Poli Penyakit Dalam', 'org2', 'active'),
    ('poli_umum_org2', 'Poli Umum', 'org2', 'active');
`);

const root = new URL("../src/", import.meta.url);

mock.module(new URL("config/database.js", root), {
  defaultExport: db,
});

mock.module(new URL("services/staffAuthService.js", root), {
  namedExports: {
    authenticateStaff(username, password) {
      if (password !== "test") return null;

      const accounts = {
        sender: {
          id: "sender",
          username: "sender",
          role: "org1",
          institution: "Org1MSP",
          institutionId: "org1",
          permission: "referral_sender",
          sessionVersion: 1,
        },
        receiver: {
          id: "receiver",
          username: "receiver",
          role: "org2",
          institution: "Org2MSP",
          institutionId: "org2",
          permission: "referral_receiver",
          sessionVersion: 1,
        },
      };

      return accounts[username] ?? null;
    },
  },
});

mock.module(new URL("services/adminAuthService.js", root), {
  namedExports: {
    authenticateAdmin(username, password) {
      if (
        username !== "nexusadmin" ||
        password !== "test"
      ) return null;

      return {
        id: "admin",
        username,
        role: "consortium_admin",
        sessionVersion: 1,
      };
    },
  },
});

mock.module(new URL("config/minio.js", root), {
  namedExports: {
    minioClient: {},
    BUCKET: "synthetic-only",
    checkMinio: async () => true,
  },
});

mock.module(new URL("services/fabricService.js", root), {
  namedExports: {
    createReferralOnFabric: async () => {
      throw new Error("Unexpected Fabric call");
    },
    getReferralFromFabric: async () => {
      throw new Error("Unexpected Fabric call");
    },
  },
});

const { login } = await import(
  new URL("middleware/auth.js", root)
);

const { default: referralRoutes } = await import(
  new URL("routes/referralRoutes.js", root)
);

test("real session cookie enforces department discovery RBAC", async () => {
  const app = express();
  app.use(express.json());
  app.post("/api/test-login", login);
  app.use("/api", referralRoutes);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1");
    instance.once("listening", () => resolve(instance));
    instance.once("error", reject);
  });

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const endpoint = `${base}/api/referral-departments`;

    async function signIn(username) {
      const response = await fetch(`${base}/api/test-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password: "test",
        }),
      });

      assert.equal(response.status, 200);

      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie?.includes("nexusmed_session="));

      return cookie.split(";")[0];
    }

    const anonymous = await fetch(endpoint);
    assert.equal(anonymous.status, 401);

    const org1 = await signIn("sender");
    const org2 = await signIn("receiver");
    const admin = await signIn("nexusadmin");

    for (const cookie of [org2, admin]) {
      const response = await fetch(endpoint, {
        headers: { cookie },
      });
      assert.equal(response.status, 403);
    }

    const allowed = await fetch(endpoint, {
      headers: { cookie: org1 },
    });

    assert.equal(allowed.status, 200);

    const body = await allowed.json();

    assert.deepEqual(
      body.departments.map(item => item.name),
      [
        "Poli Anak",
        "Poli Jantung",
        "Poli Penyakit Dalam",
        "Poli Umum",
      ]
    );

    db.prepare(`
      UPDATE institutions
      SET can_receive = 0
      WHERE id = 'org2'
    `).run();

    const unavailable = await fetch(endpoint, {
      headers: { cookie: org1 },
    });

    assert.equal(unavailable.status, 200);
    assert.deepEqual(
      (await unavailable.json()).departments,
      []
    );

    db.prepare(`
      UPDATE role_assignments
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = 'sender'
    `).run();

    const revoked = await fetch(endpoint, {
      headers: { cookie: org1 },
    });

    assert.equal(revoked.status, 401);

    console.log("Anonymous: 401 PASS");
    console.log("Org2: 403 PASS");
    console.log("Admin: 403 PASS");
    console.log("Org1 cookie: 200 PASS");
    console.log("All four departments: PASS");
    console.log("Receiver disabled: EMPTY PASS");
    console.log("Sender role revoked: 401 PASS");
    console.log("No session cookies printed");
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error =>
        error ? reject(error) : resolve()
      );
    });
    db.close();
  }
});
