import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE institutions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    can_receive INTEGER NOT NULL
  );

  CREATE TABLE departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    status TEXT NOT NULL
  );

  -- Required by createReferralAccessGuard during route initialization.
  -- This exists only in the isolated in-memory test database.
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
    ('org2', 'approved', 1),
    ('org3', 'approved', 1),
    ('org4', 'suspended', 1);

  INSERT INTO departments VALUES
    ('poli_umum_org2', 'Poli Umum', 'org2', 'active'),
    ('poli_anak_org2', 'Poli Anak', 'org2', 'active'),
    ('poli_jantung_org2', 'Poli Jantung', 'org2', 'active'),
    ('poli_inactive_org2', 'Tidak Aktif', 'org2', 'inactive'),
    ('poli_umum_org3', 'Poli Umum Org3', 'org3', 'active'),
    ('poli_umum_org4', 'Poli Umum Org4', 'org4', 'active');
`);

let identity = null;

// Test-only identity injection. Not production authentication.
mock.module(
  new URL("../src/config/database.js", import.meta.url),
  { defaultExport: db },
);

mock.module(
  new URL("../src/middleware/auth.js", import.meta.url),
  {
    namedExports: {
      requireRole(role) {
        return [
          (req, res, next) => {
            if (!identity) {
              return res.status(401).json({
                error: "Test session missing",
              });
            }
            req.user = { ...identity };
            next();
          },
          (req, res, next) => {
            if (req.user.role !== role) {
              return res.status(403).json({
                error: "Test role forbidden",
              });
            }
            next();
          },
        ];
      },
    },
  },
);

mock.module(
  new URL("../src/config/minio.js", import.meta.url),
  {
    namedExports: {
      minioClient: {},
      BUCKET: "test-only",
      checkMinio: async () => true,
    },
  },
);

mock.module(
  new URL("../src/services/fabricService.js", import.meta.url),
  {
    namedExports: {
      createReferralOnFabric: async () => {
        throw new Error("Fabric must not be called");
      },
      getReferralFromFabric: async () => {
        throw new Error("Fabric must not be called");
      },
    },
  },
);

let server;
let base;

before(async () => {
  const { default: router } = await import(
    "../src/routes/referralRoutes.js"
  );

  const app = express();
  app.use("/api", router);

  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });

  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close(error =>
        error ? reject(error) : resolve()
      );
    });
  }
  db.close();
});

test("anonymous cannot discover departments", async () => {
  identity = null;

  const response = await fetch(
    `${base}/api/referral-departments`
  );

  assert.equal(response.status, 401);
});

for (const role of ["org2", "consortium_admin"]) {
  test(`${role} cannot discover sender destinations`, async () => {
    identity = { role };

    const response = await fetch(
      `${base}/api/referral-departments`
    );

    assert.equal(response.status, 403);
  });
}

test("Org1 discovers only eligible Org2 departments", async () => {
  identity = { role: "org1" };

  const response = await fetch(
    `${base}/api/referral-departments`
  );

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.status, "success");

  assert.deepEqual(
    body.departments.map(item => item.id),
    [
      "poli_anak_org2",
      "poli_jantung_org2",
      "poli_umum_org2",
    ]
  );

  assert.ok(
    body.departments.every(
      item => item.institution_id === "org2"
    )
  );

  assert.ok(
    body.departments.every(
      item => Object.keys(item).sort().join(",") ===
        "id,institution_id,name"
    )
  );
});

test("suspended receiver fails closed", async () => {
  identity = { role: "org1" };

  db.prepare(`
    UPDATE institutions
    SET status = 'suspended'
    WHERE id = 'org2'
  `).run();

  const response = await fetch(
    `${base}/api/referral-departments`
  );

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.deepEqual(body.departments, []);
});
