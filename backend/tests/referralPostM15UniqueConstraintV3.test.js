import test, {
  before,
  beforeEach,
  after,
  mock,
} from "node:test";

import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import express from "express";

import {
  migrateFabricSubmissionJournalV3,
} from "../src/services/fabricSubmissionJournalMigrationV3.js";

import {
  migrateTxIdOwnershipCandidateV3,
} from "../src/services/fabricSubmissionOwnershipTxIdCandidateV3.js";

import {
  migrateAdmissionCandidateV3,
} from "../src/services/fabricAdmissionCandidateV3.js";

import {
  createAdmittedRegistryIntentCandidateV3 as realAdmit85A,
} from "../src/services/fabricRegistryAdmissionIntegrationCandidateV3.js";

import {
  createReferralIntent as realLegacyIntent85A,
} from "../src/services/referralRegistryService.js";
import {
  executeFabricJournalGatewayV3 as realJournalAdapter56B,
} from "../src/services/fabricJournalGatewayAdapterV3.js";

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


db.exec(`
  CREATE TABLE institution_public_keys (
    key_id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    public_key_jwk TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    retired_at TEXT
  );
`);

const objects = new Map();
const ledgerRecords = new Map();

// Migrations apply ONLY to the in-memory test DB.
migrateFabricSubmissionJournalV3(db);
migrateTxIdOwnershipCandidateV3(db);
migrateAdmissionCandidateV3(db);

let skipAdmission85A = false;
let unknownOutcome85A = false;

const calls85A = {
  created: 0,
  submitted: 0,
};

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

let journalAdapterCalls = 0;
let journalAdapterFault = false;

let useRealJournalAdapter56B = false;
let fakeJournalSubmitFailure56B = false;

const gatewayCalls56B = {
  factory: 0,
  created: 0,
  submitted: 0,
  disconnected: 0,
};

const TXID_56B = "b".repeat(64);

async function fakeJournalGatewayFactory56B() {
  gatewayCalls56B.factory++;

  return {
    async getNetwork(channel) {
      assert.equal(channel, "referralchannel");

      return {
        getContract(chaincode) {
          assert.equal(chaincode, "rujukan");

          return {
            createTransaction(method) {
              gatewayCalls56B.created++;
              assert.equal(method, "CreateReferral");

              return {
                setEndorsingOrganizations(...orgs) {
                  assert.deepEqual(
                    orgs,
                    ["Org1MSP", "Org2MSP"]
                  );
                },

                getTransactionId() {
                  return TXID_56B;
                },

                async submit(...args) {
                  gatewayCalls56B.submitted++;

                  const saved = db.prepare(`
                    SELECT transaction_id, status,
                           document_hash
                    FROM fabric_submission_journal_v3
                    WHERE referral_id = ?
                  `).get(args[0]);

                  assert.equal(
                    saved.transaction_id,
                    TXID_56B
                  );
                  assert.equal(saved.status, "prepared");
                  assert.equal(
                    saved.document_hash,
                    args[3]
                  );

                  if (fakeJournalSubmitFailure56B) {
                    throw new Error(
                      "SYNTHETIC_PRIVATE_PATIENT_056B"
                    );
                  }

                  return Buffer.from(
                    "synthetic-submit-response"
                  );
                },
              };
            },
          };
        },
      };
    },

    async disconnect() {
      gatewayCalls56B.disconnected++;
    },
  };
}

mock.module(
  new URL(
    "../src/services/fabricJournalGatewayAdapterV3.js",
    import.meta.url
  ),
  {
    namedExports: {
      async executeFabricJournalGatewayV3(input) {
        journalAdapterCalls++;

        if (useRealJournalAdapter56B) {
          return realJournalAdapter56B(input);
        }

        assert.equal(input.mode, "prepare_only");
        assert.equal(input.storageConfirmed, true);
        assert.equal(typeof input.gatewayFactory, "function");

        if (journalAdapterFault) {
          throw new Error("SYNTHETIC_SECRET_PATIENT_055");
        }

        // HTTP integration mock only.
        // This does not claim a durable journal or commit.
        return {
          path: "journal_candidate",
          status: "pending_evidence",
          allowRegistryCommit: false,
          allowFabricRetry: false,
        };
      },
    },
  }
);

mock.module(
  new URL(
    "../src/services/fabricJournalGatewayFactoryV3.js",
    import.meta.url
  ),
  {
    namedExports: {
      async createJournalGatewayV3() {
        if (!useRealJournalAdapter56B) {
          throw new Error("M15_GATEWAY_NOT_CONFIGURED");
        }

        return fakeJournalGatewayFactory56B();
      },
    },
  }
);

// M15 TEST-ONLY CONTRACT INJECTION.
// No real Fabric SDK or Gateway is imported.
mock.module(
  new URL(
    "../src/services/fabricOfflineContractProviderCandidateV3.js",
    import.meta.url
  ),
  {
    namedExports: {
      createOfflineFabricContractCandidateV3({
        referralId,
      }) {
        return {
          createTransaction(method) {
            assert.equal(method, "CreateReferral");
            calls85A.created++;

            return {
              setEndorsingOrganizations(...orgs) {
                assert.deepEqual(
                  orgs,
                  ["Org1MSP", "Org2MSP"]
                );
              },

              getTransactionId() {
                return createHash("sha256")
                  .update("M15-P2:" + referralId)
                  .digest("hex");
              },

              async submit(...args) {
                calls85A.submitted++;

                // Durable ownership MUST exist before
                // the external submit is attempted.
                const claim = db.prepare(`
                  SELECT transaction_id, document_hash
                  FROM fabric_submission_ownership_txid_candidate_v3
                  WHERE referral_id = ?
                `).get(args[0]);

                const expectedTxId = createHash("sha256")
                  .update("M15-P2:" + referralId)
                  .digest("hex");

                assert.ok(
                  claim,
                  "DURABLE_OWNERSHIP_MISSING"
                );

                assert.equal(
                  claim.transaction_id,
                  expectedTxId
                );

                assert.equal(
                  claim.document_hash,
                  args[3]
                );

                if (unknownOutcome85A) {
                  throw new Error(
                    "SYNTHETIC_SUBMISSION_UNKNOWN"
                  );
                }

                return Buffer.from(
                  "synthetic-submit-success"
                );
              },
            };
          },
        };
      },
    },
  }
);

// Test-only legacy writer simulation.
// Normal requests use the actual admission wrapper.
mock.module(
  new URL(
    "../src/services/fabricRegistryAdmissionIntegrationCandidateV3.js",
    import.meta.url
  ),
  {
    namedExports: {
      createAdmittedRegistryIntentCandidateV3(db, input) {
        if (skipAdmission85A) {
          return realLegacyIntent85A(db, input);
        }
        return realAdmit85A(db, input);
      },
    },
  }
);

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
    "../src/routes/referralRoutesM15CandidateV3.js"
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
  skipAdmission85A = false;
  unknownOutcome85A = false;
  calls85A.created = 0;
  calls85A.submitted = 0;
  db.prepare("DELETE FROM institution_public_keys").run();
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "legacy";
  delete process.env.NEXUSMED_FABRIC_JOURNAL_MODE;
  journalAdapterCalls = 0;
  journalAdapterFault = false;
  useRealJournalAdapter56B = false;
  fakeJournalSubmitFailure56B = false;

  for (const key of Object.keys(gatewayCalls56B)) {
    gatewayCalls56B[key] = 0;
  }
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


// === M15 REAL ROUTE V2 TESTS ===
// SQLite and storage are mocked by this existing HTTP harness.

async function makeV2HttpPayload() {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  const jwk = await webcrypto.subtle.exportKey(
    "jwk",
    pair.publicKey
  );

  const fingerprint = createHash("sha256")
    .update(Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    ]))
    .digest("hex");

  db.prepare(`
    INSERT INTO institution_public_keys
      (key_id, institution_id, version,
       public_key_jwk, fingerprint, status, retired_at)
    VALUES (?, 'org2', 1, ?, ?, 'active', NULL)
  `).run(
    "synthetic-v2-http-key",
    JSON.stringify(jwk),
    fingerprint
  );

  const payload = {
    version: 2,
    algorithm: "AES-256-GCM + ECDH-P256 + HKDF-SHA256",
    receiverKey: {
      institutionId: "org2",
      keyId: "synthetic-v2-http-key",
      version: 1,
      fingerprint,
    },
    ciphertext: Buffer.alloc(32, 1).toString("base64"),
    iv: Buffer.alloc(12, 2).toString("base64"),
    wrappedKey: Buffer.alloc(48, 3).toString("base64"),
    wrapIv: Buffer.alloc(12, 4).toString("base64"),
    salt: Buffer.alloc(16, 5).toString("base64"),
    ephemeralPublicKey: jwk,
  };

  const {
    calculateReferralDocumentHash,
  } = await import(
    "../src/services/versionedReferralIntegrity.js"
  );

  payload.documentHash = calculateReferralDocumentHash({
    ...payload,
    documentHash: "0".repeat(64),
  });

  return payload;
}

function assertV2HttpNoWrites() {
  assert.equal(registry(), undefined);
  assert.equal(objects.size, 0);
  assert.equal(ledgerRecords.size, 0);
}

test("M15 POST v2: default legacy gate rejects before writes", async () => {
  const payload = await makeV2HttpPayload();

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 400);
  assertV2HttpNoWrites();
});

test("M15 POST v2: valid registry-bound referral committed", async () => {
  const payload = await makeV2HttpPayload();
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 201);
  assert.equal(registry().document_hash, payload.documentHash);
  assert.equal(registry().status, "committed");
  assert.equal(objects.size, 1);
  assert.equal(ledgerRecords.size, 1);
});

test("M15 POST v2: legacy downgrade rejected", async () => {
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  const result = await post();

  assert.equal(result.code, 400);
  assertV2HttpNoWrites();
});

test("M15 POST v2: tampered ciphertext rejected before writes", async () => {
  const payload = await makeV2HttpPayload();
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  payload.ciphertext = Buffer.alloc(32, 9).toString("base64");

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 400);
  assertV2HttpNoWrites();
});

test("M15 POST v2: forged key ID rejected before writes", async () => {
  const payload = await makeV2HttpPayload();
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  payload.receiverKey.keyId = "forged-key-id";

  const {
    calculateReferralDocumentHash,
  } = await import(
    "../src/services/versionedReferralIntegrity.js"
  );

  payload.documentHash = calculateReferralDocumentHash(payload);

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 400);
  assertV2HttpNoWrites();
});

test("M15 POST v2: retired key rejected before writes", async () => {
  const payload = await makeV2HttpPayload();
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  db.prepare(`
    UPDATE institution_public_keys
    SET status = 'retired',
        retired_at = '2026-11-17 12:00:00'
  `).run();

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 400);
  assertV2HttpNoWrites();
});

test("M15 POST v2: off-curve point rejected before writes", async () => {
  const payload = await makeV2HttpPayload();
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  payload.ephemeralPublicKey = {
    kty: "EC",
    crv: "P-256",
    x: "A".repeat(43),
    y: "A".repeat(43),
  };

  const {
    calculateReferralDocumentHash,
  } = await import(
    "../src/services/versionedReferralIntegrity.js"
  );

  payload.documentHash = calculateReferralDocumentHash(payload);

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 400);
  assertV2HttpNoWrites();
});

test("M15 POST v2: registry fingerprint mismatch rejected", async () => {
  const payload = await makeV2HttpPayload();
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  db.prepare(`
    UPDATE institution_public_keys SET fingerprint = ?
  `).run("b".repeat(64));

  payload.receiverKey.fingerprint = "b".repeat(64);

  const {
    calculateReferralDocumentHash,
  } = await import(
    "../src/services/versionedReferralIntegrity.js"
  );

  payload.documentHash = calculateReferralDocumentHash(payload);

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 400);
  assertV2HttpNoWrites();
});

test("M15 POST v2: invalid gate fails before writes", async () => {
  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "invalid-mode";

  const result = await post();

  assert.equal(result.code, 503);
  assertV2HttpNoWrites();
});


// === M15 VERIFIED GET V2 TESTS ===

async function storeSyntheticV2ForGet() {
  const payload = await makeV2HttpPayload();

  process.env.NEXUSMED_REFERRAL_WRITE_MODE = "v2_only";

  const result = await post(requestBody({ payload }));

  assert.equal(result.code, 201);
  assert.equal(registry().status, "committed");

  return payload;
}

function mutateStoredV2(mutator) {
  const key = "referrals/REF-POST-TEST.json";

  const document = JSON.parse(
    objects.get(key).toString("utf8")
  );

  mutator(document.payload);

  objects.set(
    key,
    Buffer.from(JSON.stringify(document))
  );
}

test("M15 GET v2: valid envelope verified", async () => {
  const payload = await storeSyntheticV2ForGet();

  useReceiver();

  const result = await getVerified();

  assert.equal(result.code, 200);
  assert.equal(result.body.status, "integrity_verified");
  assert.equal(result.body.verified, true);
  assert.equal(result.body.calculatedHash, payload.documentHash);
  assert.equal(result.body.ledgerHash, payload.documentHash);
  assert.equal(result.body.payload.version, 2);
});

test("M15 GET v2: retired key preserves historical verification", async () => {
  const payload = await storeSyntheticV2ForGet();

  db.prepare(`
    UPDATE institution_public_keys
    SET status = 'retired',
        retired_at = '2026-11-17 12:00:00'
  `).run();

  useReceiver();

  const result = await getVerified();

  assert.equal(result.code, 200);
  assert.equal(result.body.verified, true);
  assert.equal(result.body.calculatedHash, payload.documentHash);
});

test("M15 GET v2: wrapping metadata tampering rejected", async () => {
  await storeSyntheticV2ForGet();

  mutateStoredV2(payload => {
    payload.wrapIv =
      Buffer.alloc(12, 9).toString("base64");
  });

  useReceiver();

  const result = await getVerified();

  assert.equal(result.code, 409);
  assert.equal(result.body.status, "integrity_failed");
  assert.equal(result.body.verified, false);
});

test("M15 GET v2: receiver identity tampering rejected", async () => {
  await storeSyntheticV2ForGet();

  mutateStoredV2(payload => {
    payload.receiverKey.keyId = "forged-receiver-key";
  });

  useReceiver();

  const result = await getVerified();

  assert.equal(result.code, 409);
  assert.equal(result.body.status, "integrity_failed");
  assert.equal(result.body.verified, false);
});

test("M15 GET v2: recomputed forged hash still rejected", async () => {
  await storeSyntheticV2ForGet();

  const {
    calculateReferralDocumentHash,
  } = await import(
    "../src/services/versionedReferralIntegrity.js"
  );

  mutateStoredV2(payload => {
    payload.receiverKey.keyId = "forged-receiver-key";
    payload.documentHash =
      calculateReferralDocumentHash(payload);
  });

  useReceiver();

  const result = await getVerified();

  assert.equal(result.code, 409);
  assert.equal(result.body.status, "integrity_failed");
  assert.equal(result.body.verified, false);
});

test("M15 GET v2: wrong department blocked before storage", async () => {
  await storeSyntheticV2ForGet();

  useReceiver("doctor-saraf");

  const beforeMinio = minioReads;
  const beforeFabric = fabricReads;

  const result = await getVerified();

  assert.equal(result.code, 403);
  assert.equal(minioReads, beforeMinio);
  assert.equal(fabricReads, beforeFabric);
});


test("M15 journal Phase 1: missing schema blocks candidate submission", async () => {
  process.env.NEXUSMED_FABRIC_JOURNAL_MODE = "prepare_only";

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(result.body.status, "pending_ledger");
  assert.equal(registry().status, "pending_ledger");
  assert.equal(objects.size, 1);
  assert.equal(ledgerRecords.size, 0);
});

test("M15 journal Phase 1: invalid mode fails before writes", async () => {
  process.env.NEXUSMED_FABRIC_JOURNAL_MODE = "unsafe_fallback";

  const result = await post();

  assert.equal(result.code, 503);
  assert.equal(registry(), undefined);
  assert.equal(objects.size, 0);
  assert.equal(ledgerRecords.size, 0);
  assert.equal(journalAdapterCalls, 0);
});

test("M15 journal Phase 1: empty mode fails before writes", async () => {
  process.env.NEXUSMED_FABRIC_JOURNAL_MODE = "";

  const result = await post();

  assert.equal(result.code, 503);
  assert.equal(registry(), undefined);
  assert.equal(objects.size, 0);
  assert.equal(ledgerRecords.size, 0);
  assert.equal(journalAdapterCalls, 0);
});


test("M15 journal Phase 2A: HTTP invokes mocked adapter", async () => {
  const { migrateFabricSubmissionJournalV3 } =
    await import(
      "../src/services/fabricSubmissionJournalMigrationV3.js"
    );

  migrateFabricSubmissionJournalV3(db);

  process.env.NEXUSMED_FABRIC_JOURNAL_MODE = "prepare_only";

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(result.body.status, "pending_ledger");
  assert.equal(journalAdapterCalls, 1);
  assert.equal(ledgerRecords.size, 0);
  assert.equal(registry().status, "pending_ledger");
});

test("M15 journal Phase 2A: adapter failure remains pending", async () => {
  process.env.NEXUSMED_FABRIC_JOURNAL_MODE = "prepare_only";
  journalAdapterFault = true;

  const result = await post();

  assert.equal(result.code, 202);
  assert.equal(result.body.status, "pending_ledger");
  assert.equal(journalAdapterCalls, 1);
  assert.equal(ledgerRecords.size, 0);
  assert.equal(registry().status, "pending_ledger");

  assert.equal(
    JSON.stringify(result.body).includes(
      "SYNTHETIC_SECRET_PATIENT_055"
    ),
    false
  );
});


function cleanupJournal56B() {
  // Isolated test database only.
  // An immutable prepared journal must never be
  // deleted this way from a real environment.
  db.exec(`
    DROP TRIGGER IF EXISTS
      trg_fabric_journal_v3_no_update;

    DROP TRIGGER IF EXISTS
      trg_fabric_journal_v3_no_delete;

    DROP TABLE IF EXISTS
      fabric_submission_journal_v3;
  `);
}

test("M15 journal Phase 2B: HTTP prepares durable attempt before fake submit", async () => {
  const { migrateFabricSubmissionJournalV3 } =
    await import(
      "../src/services/fabricSubmissionJournalMigrationV3.js"
    );

  migrateFabricSubmissionJournalV3(db);

  try {
    useRealJournalAdapter56B = true;
    process.env.NEXUSMED_FABRIC_JOURNAL_MODE =
      "prepare_only";

    const result = await post();

    assert.equal(result.code, 202);
    assert.equal(result.body.status, "pending_ledger");

    assert.equal(journalAdapterCalls, 1);
    assert.equal(gatewayCalls56B.factory, 1);
    assert.equal(gatewayCalls56B.created, 1);
    assert.equal(gatewayCalls56B.submitted, 1);
    assert.equal(gatewayCalls56B.disconnected, 1);

    const saved = db.prepare(`
      SELECT transaction_id, status
      FROM fabric_submission_journal_v3
      WHERE referral_id = ?
    `).get("REF-POST-TEST");

    assert.equal(saved.transaction_id, TXID_56B);
    assert.equal(saved.status, "prepared");
    assert.equal(registry().status, "pending_ledger");

    // The M14 mock ledger is never called.
    assert.equal(ledgerRecords.size, 0);

    assert.equal(
      JSON.stringify(result.body).includes(TXID_56B),
      false
    );
  } finally {
    cleanupJournal56B();
  }
});

test("M15 journal Phase 2B: failed submit retains prepared journal", async () => {
  const { migrateFabricSubmissionJournalV3 } =
    await import(
      "../src/services/fabricSubmissionJournalMigrationV3.js"
    );

  migrateFabricSubmissionJournalV3(db);

  try {
    useRealJournalAdapter56B = true;
    fakeJournalSubmitFailure56B = true;

    process.env.NEXUSMED_FABRIC_JOURNAL_MODE =
      "prepare_only";

    const result = await post();

    assert.equal(result.code, 202);
    assert.equal(result.body.status, "pending_ledger");

    assert.equal(gatewayCalls56B.submitted, 1);
    assert.equal(gatewayCalls56B.disconnected, 1);

    const saved = db.prepare(`
      SELECT transaction_id, status
      FROM fabric_submission_journal_v3
      WHERE referral_id = ?
    `).get("REF-POST-TEST");

    assert.equal(saved.transaction_id, TXID_56B);
    assert.equal(saved.status, "prepared");
    assert.equal(registry().status, "pending_ledger");

    assert.equal(
      JSON.stringify(result.body).includes(
        "SYNTHETIC_PRIVATE_PATIENT_056B"
      ),
      false
    );

    assert.equal(ledgerRecords.size, 0);
  } finally {
    cleanupJournal56B();
  }
});



test(
  "85K: missing UNIQUE TxID must fail closed",
  async () => {
    const tables = [
      "fabric_submission_ownership_txid_candidate_v3",
      "fabric_submission_journal_v3",
    ];

    function hasUniqueTxId(table) {
      const indexes = db.prepare(
        `PRAGMA index_list("${table}")`
      ).all();

      return indexes.some(index => {
        if (index.unique !== 1 || index.partial === 1) {
          return false;
        }

        const name = index.name.replaceAll('"', '""');

        const columns = db.prepare(
          `PRAGMA index_info("${name}")`
        ).all();

        return columns.length === 1 &&
          columns[0].name === "transaction_id";
      });
    }

    function rebuildWithoutTxIdUnique(table) {
      // Fixed internal test fixture names only.
      assert.ok(tables.includes(table));

      const definition = db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `).get(table)?.sql;

      assert.ok(definition);
      assert.equal(hasUniqueTxId(table), true);

      const changed = definition.replace(
        /(\btransaction_id\s+TEXT\s+NOT\s+NULL)\s+UNIQUE\b/i,
        "$1"
      );

      assert.notEqual(
        changed,
        definition,
        "TXID_UNIQUE_DEFINITION_NOT_FOUND"
      );

      const triggers = db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'trigger'
          AND tbl_name = ?
      `).all(table).map(row => row.sql);

      const indexes = db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name = ?
          AND sql IS NOT NULL
      `).all(table).map(row => row.sql);

      // All DDL is executed ONLY on the test's
      // private SQLite :memory: database.
      db.exec(`DROP TABLE "${table}"`);
      db.exec(changed);

      for (const sql of indexes) db.exec(sql);
      for (const sql of triggers) db.exec(sql);

      assert.equal(
        hasUniqueTxId(table),
        false,
        "TXID_UNIQUE_STILL_PRESENT"
      );

      return () => {
        db.exec(`DROP TABLE "${table}"`);
        db.exec(definition);

        for (const sql of indexes) db.exec(sql);
        for (const sql of triggers) db.exec(sql);

        assert.equal(hasUniqueTxId(table), true);
      };
    }

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const id = "REF-M15-UNIQUE-85K-" + (i + 1);
      const key = "referrals/" + id + ".json";

      assert.equal(
        db.prepare(`
          SELECT COUNT(*) AS n
          FROM referral_registry
        `).get().n,
        0
      );

      const restore = rebuildWithoutTxIdUnique(table);

      try {
        const submitsBefore = calls85A.submitted;

        const response = await post(
          requestBody({ referralId: id })
        );

        console.log(
          "85K_TABLE=" + table
        );
        console.log(
          "85K_HTTP=" + response.code
        );
        console.log(
          "85K_SUBMIT_DELTA=" +
          (calls85A.submitted - submitsBefore)
        );
        console.log(
          "85K_STORAGE_WRITE=" + objects.has(key)
        );

        assert.equal(
          response.code,
          503,
          "MISSING_TXID_UNIQUE_MUST_RETURN_503"
        );

        assert.equal(
          response.body.reason,
          "M15_SCHEMA_NOT_READY"
        );

        assert.equal(
          db.prepare(`
            SELECT referral_id
            FROM referral_registry
            WHERE referral_id = ?
          `).get(id),
          undefined
        );

        assert.equal(objects.has(key), false);
        assert.equal(calls85A.submitted, submitsBefore);
      } finally {
        restore();
      }
    }
  }
);
