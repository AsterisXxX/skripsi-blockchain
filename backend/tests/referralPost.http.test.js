import test, {
  before,
  beforeEach,
  after,
  mock,
} from "node:test";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import express from "express";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE institutions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    can_send INTEGER NOT NULL,
    can_receive INTEGER NOT NULL
  );

  CREATE TABLE departments (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    status TEXT NOT NULL,
    UNIQUE (institution_id, id)
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE role_assignments (
    user_id TEXT,
    role TEXT,
    revoked_at TEXT
  );

  CREATE TABLE user_department_assignments (
    user_id TEXT,
    department_id TEXT,
    revoked_at TEXT
  );

  CREATE TABLE referral_registry (
    referral_id TEXT PRIMARY KEY,
    sender_institution_id TEXT NOT NULL,
    receiver_institution_id TEXT NOT NULL,
    target_department_id TEXT NOT NULL,
    document_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    fabric_transaction_id TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (
      receiver_institution_id,
      target_department_id
    ) REFERENCES departments(institution_id, id)
  );

  INSERT INTO institutions VALUES
    ('org1', 'approved', 1, 0),
    ('org2', 'approved', 0, 1);

  INSERT INTO departments VALUES
    ('poli_umum_org2', 'org2', 'active');
`);

db.exec(`
  INSERT INTO institutions VALUES
    ('org3', 'approved', 0, 1);

  INSERT INTO departments VALUES
    ('poli_saraf_org2', 'org2', 'active'),
    ('poli_umum_org3', 'org3', 'active');

  INSERT INTO users VALUES
    ('doctor-umum', 'org2', 'active'),
    ('doctor-saraf', 'org2', 'active'),
    ('doctor-org3', 'org3', 'active');

  INSERT INTO role_assignments VALUES
    ('doctor-umum', 'referral_receiver', NULL),
    ('doctor-saraf', 'referral_receiver', NULL),
    ('doctor-org3', 'referral_receiver', NULL);

  INSERT INTO user_department_assignments VALUES
    ('doctor-umum', 'poli_umum_org2', NULL),
    ('doctor-saraf', 'poli_saraf_org2', NULL),
    ('doctor-org3', 'poli_umum_org3', NULL);
`);

const objects = new Map();
const ledgerRecords = new Map();

let storageFault = null;
let fabricFault = null;
let minioReads = 0;
let fabricReads = 0;
let identity = {
  userId: "synthetic-sender",
  role: "org1",
  institutionId: "org1",
  institution: "Org1MSP",
};

const minioClient = {
  async statObject(bucket, key) {
    if (!objects.has(key)) {
      throw Object.assign(new Error("Not found"), {
        code: "NoSuchKey",
      });
    }
    return { size: objects.get(key).length };
  },

  async putObject(bucket, key, buffer) {
    if (storageFault === "before_write") {
      throw new Error("Synthetic storage failure");
    }

    objects.set(key, Buffer.from(buffer));

    if (storageFault === "after_write") {
      throw new Error("Synthetic response lost");
    }
  },

  async getObject(bucket, key) {
    minioReads += 1;
    const object = objects.get(key);

    if (!object) {
      throw Object.assign(new Error("Not found"), {
        code: "NoSuchKey",
      });
    }

    return Readable.from([object]);
  },
};

async function createReferralOnFabric({
  referralId,
  documentHash,
}) {
  if (fabricFault === "submit_failure") {
    throw new Error("Synthetic Fabric failure");
  }

  ledgerRecords.set(referralId, {
    referralId,
    recordHash: documentHash,
  });

  return {
    status: "committed",
    referralId,
    documentHash,
    transactionId: "synthetic-tx-" + referralId,
  };
}

async function getReferralFromFabric(referralId) {
  fabricReads += 1;
  if (fabricFault === "read_failure") {
    throw new Error("Synthetic ledger read failure");
  }

  const result = ledgerRecords.get(referralId);

  if (!result) {
    throw new Error("Referral missing from ledger");
  }

  if (fabricFault === "hash_mismatch") {
    return {
      ...result,
      recordHash: "f".repeat(64),
    };
  }

  return result;
}

// Mock dependencies BEFORE importing the actual route.
mock.module(
  new URL("../src/config/database.js", import.meta.url),
  { defaultExport: db },
);

mock.module(
  new URL("../src/config/minio.js", import.meta.url),
  {
    namedExports: {
      minioClient,
      BUCKET: "synthetic-referral-bucket",
      checkMinio: async () => true,
    },
  },
);

mock.module(
  new URL("../src/services/fabricService.js", import.meta.url),
  {
    namedExports: {
      createReferralOnFabric,
      getReferralFromFabric,
    },
  },
);

// Test-only authentication injection.
// Does NOT test real cookies or password verification.
mock.module(
  new URL("../src/middleware/auth.js", import.meta.url),
  {
    namedExports: {
      requireRole(role) {
        return [
          (req, res, next) => {
            req.user = { ...identity };
            next();
          },
          (req, res, next) => {
            if (req.user.role !== role) {
              return res.status(403).json({
                error: "Forbidden test identity",
              });
            }
            next();
          },
        ];
      },
    },
  },
);

let server;
let baseUrl;

before(async () => {
  const { default: router } = await import(
    "../src/routes/referralRoutes.js"
  );

  const app = express();
  app.use(express.json());
  app.use("/api", router);

  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });

  baseUrl =
    `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  db.prepare("DELETE FROM referral_registry").run();

  objects.clear();
  ledgerRecords.clear();

  storageFault = null;
  fabricFault = null;
  minioReads = 0;
  fabricReads = 0;

  db.prepare(`
    UPDATE user_department_assignments
    SET revoked_at = NULL
  `).run();

  db.prepare(`
    UPDATE role_assignments
    SET revoked_at = NULL
  `).run();

  identity = {
    userId: "synthetic-sender",
    role: "org1",
    institutionId: "org1",
    institution: "Org1MSP",
  };
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

const ciphertext = Buffer.from(
  "synthetic-ciphertext-for-integration-test",
);

const hash = createHash("sha256")
  .update(ciphertext)
  .digest("hex");

function requestBody(overrides = {}) {
  return {
    referralId: "REF-POST-TEST",
    patientId: "SYNTH-PATIENT-001",
    targetDepartmentId: "poli_umum_org2",
    payload: {
      version: 1,
      algorithm:
        "AES-256-GCM + ECDH-P256 + HKDF-SHA256",
      ciphertext: ciphertext.toString("base64"),
      documentHash: hash,
      iv: "synthetic-iv",
      wrappedKey: "synthetic-wrapped-key",
      wrapIv: "synthetic-wrap-iv",
      salt: "synthetic-salt",
      ephemeralPublicKey: { kty: "EC" },
    },
    ...overrides,
  };
}

async function post(body = requestBody()) {
  const response = await fetch(
    `${baseUrl}/api/referrals`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  return {
    code: response.status,
    body: await response.json(),
  };
}

function registry() {
  return db.prepare(`
    SELECT *
    FROM referral_registry
    WHERE referral_id = 'REF-POST-TEST'
  `).get();
}

test("POST success: MinIO + Fabric + registry committed", async () => {
  const result = await post();

  assert.equal(result.code, 201);
  assert.equal(result.body.status, "stored_hybrid");
  assert.equal(registry().status, "committed");
  assert.equal(registry().document_hash, hash);
  assert.equal(objects.size, 1);
  assert.equal(ledgerRecords.size, 1);
});

test("POST rejects invalid target department", async () => {
  const result = await post(requestBody({
    targetDepartmentId: "poli_tidak_ada",
  }));

  assert.equal(result.code, 409);
  assert.equal(registry(), undefined);
  assert.equal(objects.size, 0);
  assert.equal(ledgerRecords.size, 0);
});

test("POST rejects wrong sender institution", async () => {
  identity.institutionId = "org2";

  const result = await post();

  assert.equal(result.code, 403);
  assert.equal(registry(), undefined);
  assert.equal(objects.size, 0);
});

test("POST rejects wrong role", async () => {
  identity.role = "org2";

  const result = await post();

  assert.equal(result.code, 403);
  assert.equal(registry(), undefined);
});

test("POST rejects incorrect ciphertext hash", async () => {
  const payload = requestBody().payload;

  const result = await post(requestBody({
    payload: {
      ...payload,
      documentHash: "0".repeat(64),
    },
  }));

  assert.equal(result.code, 400);
  assert.equal(registry(), undefined);
});

test("POST handles MinIO failure before write", async () => {
  storageFault = "before_write";

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(result.body.status, "pending_storage");
  assert.equal(registry().status, "pending_storage");
  assert.equal(objects.size, 0);
  assert.equal(ledgerRecords.size, 0);
});

test("POST handles uncertain MinIO response", async () => {
  storageFault = "after_write";

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(result.body.status, "pending_storage");
  assert.equal(registry().status, "pending_storage");
  assert.equal(objects.size, 1);
  assert.equal(ledgerRecords.size, 0);
});

test("POST handles Fabric submission failure", async () => {
  fabricFault = "submit_failure";

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(result.body.status, "pending_ledger");
  assert.equal(registry().status, "pending_ledger");
  assert.equal(objects.size, 1);
  assert.equal(ledgerRecords.size, 0);
});

test("POST handles Fabric readback failure", async () => {
  fabricFault = "read_failure";

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(registry().status, "pending_ledger");
  assert.equal(ledgerRecords.size, 1);
});

test("POST rejects inconsistent Fabric hash", async () => {
  fabricFault = "hash_mismatch";

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(registry().status, "pending_ledger");
  assert.equal(ledgerRecords.size, 1);
});

test("POST duplicate ID cannot overwrite storage", async () => {
  const first = await post();
  const second = await post();

  assert.equal(first.code, 201);
  assert.equal(second.code, 409);
  assert.equal(objects.size, 1);
  assert.equal(ledgerRecords.size, 1);
});


function useReceiver(userId = "doctor-umum", institutionId = "org2") {
  identity = {
    userId,
    role: "org2",
    institutionId,
    institution: institutionId === "org2"
      ? "Org2MSP"
      : "Org3MSP",
  };
}

async function getVerified(id = "REF-POST-TEST") {
  const response = await fetch(
    `${baseUrl}/api/referrals/${encodeURIComponent(id)}/verified`,
  );

  return {
    code: response.status,
    body: await response.json(),
  };
}

test("GET authorized doctor receives verified ciphertext", async () => {
  assert.equal((await post()).code, 201);

  useReceiver();

  const result = await getVerified();

  assert.equal(result.code, 200);
  assert.equal(result.body.verified, true);
  assert.equal(result.body.calculatedHash, hash);
  assert.equal(result.body.payload.documentHash, hash);
  assert.equal(minioReads, 1);
  assert.equal(fabricReads, 2);
});

test("GET wrong department cannot reach MinIO or Fabric", async () => {
  assert.equal((await post()).code, 201);

  useReceiver("doctor-saraf");
  const beforeMinio = minioReads;
  const beforeFabric = fabricReads;

  const result = await getVerified();

  assert.equal(result.code, 403);
  assert.equal(minioReads, beforeMinio);
  assert.equal(fabricReads, beforeFabric);
});

test("GET wrong institution cannot reach storage", async () => {
  assert.equal((await post()).code, 201);

  useReceiver("doctor-org3", "org3");
  const beforeMinio = minioReads;

  const result = await getVerified();

  assert.equal(result.code, 403);
  assert.equal(minioReads, beforeMinio);
});

test("GET revoked department cannot reach storage", async () => {
  assert.equal((await post()).code, 201);

  db.prepare(`
    UPDATE user_department_assignments
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = 'doctor-umum'
  `).run();

  useReceiver();
  const beforeMinio = minioReads;

  const result = await getVerified();

  assert.equal(result.code, 403);
  assert.equal(minioReads, beforeMinio);
});

test("GET uncommitted referral is blocked", async () => {
  fabricFault = "submit_failure";

  assert.equal((await post()).code, 202);

  useReceiver();
  const beforeMinio = minioReads;

  const result = await getVerified();

  assert.equal(result.code, 409);
  assert.equal(minioReads, beforeMinio);
});

test("GET detects tampered ciphertext", async () => {
  assert.equal((await post()).code, 201);

  const key = "referrals/REF-POST-TEST.json";
  const document = JSON.parse(
    objects.get(key).toString("utf8")
  );

  document.payload.ciphertext =
    Buffer.from("tampered-ciphertext").toString("base64");

  objects.set(
    key,
    Buffer.from(JSON.stringify(document)),
  );

  useReceiver();

  const result = await getVerified();

  assert.equal(result.code, 409);
  assert.equal(result.body.verified, false);
  assert.equal(result.body.status, "integrity_failed");
});

test("GET missing legacy registry fails closed", async () => {
  objects.set(
    "referrals/REF-POST-TEST.json",
    Buffer.from(JSON.stringify({
      referralId: "REF-POST-TEST",
      payload: requestBody().payload,
    })),
  );

  useReceiver();
  const beforeMinio = minioReads;

  const result = await getVerified();

  assert.equal(result.code, 404);
  assert.equal(minioReads, beforeMinio);
});
