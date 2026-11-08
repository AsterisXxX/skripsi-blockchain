import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import Database from "better-sqlite3";
import express from "express";

import {
  inspectLegacyPublicKey,
  createLegacyPoPProof,
} from "../../frontend/src/services/legacyKeyPoP.js";

globalThis.crypto ??= webcrypto;

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE institutions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    can_receive INTEGER NOT NULL
  );

  CREATE TABLE institution_public_keys (
    key_id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    public_key_jwk TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    retired_at TEXT
  );

  INSERT INTO institutions VALUES
    ('org2', 'approved', 1),
    ('org3', 'approved', 1);
`);

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  REGISTRATION: process.env.NEXUSMED_KEY_REGISTRATION_ENABLED,
  USER: process.env.NEXUSMED_KEY_ENROLLMENT_USER_ID,
};

process.env.NODE_ENV = "test";
process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "true";
process.env.NEXUSMED_KEY_ENROLLMENT_USER_ID = "designated-org2";

let identity = {
  userId: "designated-org2",
  role: "org2",
  permission: "referral_receiver",
  institutionId: "org2",
  institution: "Org2MSP",
};

// Mock only authentication and database.
// PoP route, crypto verification, authorization policy,
// and registry service remain the actual implementation.
mock.module(
  new URL("../src/config/database.js", import.meta.url),
  { defaultExport: db }
);

mock.module(
  new URL("../src/middleware/auth.js", import.meta.url),
  {
    namedExports: {
      requireAuth(req, res, next) {
        if (!identity) {
          return res.status(401).json({
            error: "Login diperlukan.",
          });
        }

        req.user = identity;
        next();
      },

      requireRole(role) {
        return [
          (req, res, next) => {
            if (!identity) {
              return res.status(401).json({
                error: "Login diperlukan.",
              });
            }

            req.user = identity;
            next();
          },

          (req, res, next) => {
            if (req.user.role !== role) {
              return res.status(403).json({
                error: "Role tidak diizinkan.",
              });
            }

            next();
          },
        ];
      },
    },
  }
);

let server;
let baseUrl;

before(async () => {
  const { default: keyRoutes } = await import(
    "../src/routes/keyRoutes.js"
  );

  const app = express();
  app.use(express.json());
  app.use("/api/keys", keyRoutes);

  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");

    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => {
    if (!server) return resolve();
    server.close(resolve);
  });

  db.close();

  for (const [key, value] of Object.entries({
    NODE_ENV: originalEnv.NODE_ENV,
    NEXUSMED_KEY_REGISTRATION_ENABLED:
      originalEnv.REGISTRATION,
    NEXUSMED_KEY_ENROLLMENT_USER_ID:
      originalEnv.USER,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

let requestNumber = 0;

function cookie() {
  requestNumber++;
  return `nexusmed_session=synthetic-session-${requestNumber}`;
}

async function request(method, path, {
  body,
  session,
} = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });

  return {
    status: response.status,
    data: await response.json(),
  };
}

async function generateKey() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  const inspected = await inspectLegacyPublicKey(keys);

  return {
    keys,
    ...inspected,
  };
}

async function issueChallenge(session, key) {
  return request("POST", "/api/keys/challenge", {
    session,
    body: {
      publicKeyJwk: key.publicKeyJwk,
    },
  });
}

async function verify(session, challenge, proof) {
  return request(
    "POST",
    "/api/keys/challenge/verify",
    {
      session,
      body: {
        challengeId: challenge.challengeId,
        proof,
      },
    }
  );
}

function keyCount() {
  return db.prepare(
    "SELECT COUNT(*) AS count FROM institution_public_keys"
  ).get().count;
}

function clearRegistry() {
  db.prepare("DELETE FROM institution_public_keys").run();
}

test("HTTP: valid PoP registers Org2 public key", async () => {
  clearRegistry();

  const session = cookie();
  const key = await generateKey();
  const challenge = await issueChallenge(session, key);

  assert.equal(challenge.status, 201);
  assert.equal(
    challenge.data.protocol,
    "NexusMed-KeyPoP-v1"
  );

  const proof = await createLegacyPoPProof(
    key.keys,
    challenge.data
  );

  const result = await verify(
    session,
    challenge.data,
    proof
  );

  assert.equal(result.status, 201);
  assert.equal(result.data.status, "key_registered");
  assert.equal(result.data.key.institutionId, "org2");
  assert.equal(
    result.data.key.fingerprint,
    key.fingerprint
  );
  assert.equal(keyCount(), 1);

  const lookup = await request(
    "GET",
    "/api/keys/institutions/org2/active",
    { session }
  );

  assert.equal(lookup.status, 200);
  assert.equal(
    lookup.data.keyId,
    result.data.key.keyId
  );
  assert.equal(
    lookup.data.fingerprint,
    key.fingerprint
  );
});

test("HTTP: consumed real challenge rejects replay", async () => {
  clearRegistry();

  process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "false";

  try {
    const session = cookie();
    const key = await generateKey();
    const challenge = await issueChallenge(session, key);

    assert.equal(challenge.status, 201);

    const proof = await createLegacyPoPProof(
      key.keys,
      challenge.data
    );

    // First verification consumes the challenge.
    const first = await verify(
      session,
      challenge.data,
      proof
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.status, "proof_verified");

    // Identical challenge and proof must be rejected.
    const replay = await verify(
      session,
      challenge.data,
      proof
    );

    assert.equal(replay.status, 404);
    assert.equal(keyCount(), 0);
  } finally {
    process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "true";
  }
});

test("HTTP: invalid proof is rejected", async () => {
  clearRegistry();

  const session = cookie();
  const key = await generateKey();
  const challenge = await issueChallenge(session, key);

  assert.equal(challenge.status, 201);

  const wrongProof = "A".repeat(43);
  const result = await verify(
    session,
    challenge.data,
    wrongProof
  );

  assert.equal(result.status, 403);
  assert.equal(keyCount(), 0);

  const replay = await verify(
    session,
    challenge.data,
    wrongProof
  );

  assert.equal(replay.status, 404);
});

test("HTTP: challenge is bound to its session", async () => {
  clearRegistry();

  const originalSession = cookie();
  const otherSession = cookie();
  const key = await generateKey();

  const challenge = await issueChallenge(
    originalSession,
    key
  );

  assert.equal(challenge.status, 201);

  const proof = await createLegacyPoPProof(
    key.keys,
    challenge.data
  );

  const rejected = await verify(
    otherSession,
    challenge.data,
    proof
  );

  assert.equal(rejected.status, 403);
  assert.equal(keyCount(), 0);

  const accepted = await verify(
    originalSession,
    challenge.data,
    proof
  );

  assert.equal(accepted.status, 201);
});

test("HTTP: unappointed receiver cannot enroll", async () => {
  clearRegistry();

  identity = {
    ...identity,
    userId: "other-org2",
  };

  try {
    const key = await generateKey();

    const result = await issueChallenge(cookie(), key);

    assert.equal(result.status, 403);
    assert.equal(keyCount(), 0);
  } finally {
    identity = {
      ...identity,
      userId: "designated-org2",
    };
  }
});

test("HTTP: sender cannot issue Org2 challenge", async () => {
  identity = {
    userId: "sender-org1",
    role: "org1",
    permission: "referral_sender",
    institutionId: "org1",
    institution: "Org1MSP",
  };

  try {
    const key = await generateKey();

    const result = await issueChallenge(cookie(), key);

    assert.equal(result.status, 403);
  } finally {
    identity = {
      userId: "designated-org2",
      role: "org2",
      permission: "referral_receiver",
      institutionId: "org2",
      institution: "Org2MSP",
    };
  }
});

test("HTTP: registration disabled verifies without writing", async () => {
  clearRegistry();

  process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "false";

  try {
    const session = cookie();
    const key = await generateKey();
    const challenge = await issueChallenge(session, key);

    assert.equal(challenge.status, 201);

    const proof = await createLegacyPoPProof(
      key.keys,
      challenge.data
    );

    const result = await verify(
      session,
      challenge.data,
      proof
    );

    assert.equal(result.status, 200);
    assert.equal(result.data.status, "proof_verified");
    assert.equal(result.data.registrationEnabled, false);
    assert.equal(keyCount(), 0);
  } finally {
    process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "true";
  }
});

test("HTTP: existing registry prevents new challenge", async () => {
  clearRegistry();

  const session = cookie();
  const key = await generateKey();
  const challenge = await issueChallenge(session, key);

  assert.equal(challenge.status, 201);

  const proof = await createLegacyPoPProof(
    key.keys,
    challenge.data
  );

  const registered = await verify(
    session,
    challenge.data,
    proof
  );

  assert.equal(registered.status, 201);

  const secondKey = await generateKey();
  const duplicate = await issueChallenge(
    cookie(),
    secondKey
  );

  assert.equal(duplicate.status, 409);
  assert.equal(keyCount(), 1);
});
