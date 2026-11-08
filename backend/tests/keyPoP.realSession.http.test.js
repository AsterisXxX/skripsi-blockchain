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
    msp_id TEXT NOT NULL,
    status TEXT NOT NULL,
    can_send INTEGER NOT NULL,
    can_receive INTEGER NOT NULL
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    session_version INTEGER NOT NULL,
    institution_id TEXT
  );

  CREATE TABLE role_assignments (
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    revoked_at TEXT
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
    ('org2', 'Org2MSP', 'approved', 0, 1);

  INSERT INTO users VALUES
    ('designated-org2', 'active', 1, 'org2'),
    ('other-org2', 'active', 1, 'org2');

  INSERT INTO role_assignments VALUES
    ('designated-org2', 'referral_receiver', NULL),
    ('other-org2', 'referral_receiver', NULL);
`);

const previous = {
  nodeEnv: process.env.NODE_ENV,
  enabled: process.env.NEXUSMED_KEY_REGISTRATION_ENABLED,
  designated: process.env.NEXUSMED_KEY_ENROLLMENT_USER_ID,
};

process.env.NODE_ENV = "test";
process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "false";
process.env.NEXUSMED_KEY_ENROLLMENT_USER_ID = "designated-org2";

mock.module(
  new URL("../src/config/database.js", import.meta.url),
  { defaultExport: db }
);

// Only credential verification is replaced.
// auth.js, cookie issuance, getSession,
// requireAuth, requireRole and keyRoutes are REAL.
mock.module(
  new URL("../src/services/staffAuthService.js", import.meta.url),
  {
    namedExports: {
      authenticateStaff(username, password) {
        if (password !== "synthetic-test-password") return null;
        if (!["staff-designated", "staff-other"].includes(username)) {
          return null;
        }

        const designated = username === "staff-designated";

        return {
          id: designated ? "designated-org2" : "other-org2",
          username,
          role: "org2",
          institution: "Org2MSP",
          institutionId: "org2",
          permission: "referral_receiver",
          sessionVersion: 1,
        };
      },
    },
  }
);

mock.module(
  new URL("../src/services/adminAuthService.js", import.meta.url),
  {
    namedExports: {
      authenticateAdmin: () => null,
    },
  }
);

let server;
let url;

before(async () => {
  const auth = await import("../src/middleware/auth.js");
  const { default: keyRoutes } = await import(
    "../src/routes/keyRoutes.js"
  );

  const app = express();
  app.use(express.json());

  app.post("/api/auth/login", auth.login);
  app.get("/api/auth/me", auth.requireAuth, auth.me);
  app.use("/api/keys", keyRoutes);

  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });

  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }

  db.close();

  const restore = {
    NODE_ENV: previous.nodeEnv,
    NEXUSMED_KEY_REGISTRATION_ENABLED: previous.enabled,
    NEXUSMED_KEY_ENROLLMENT_USER_ID: previous.designated,
  };

  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function http(method, path, { cookie, body } = {}) {
  const response = await fetch(url + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function login(username = "staff-designated") {
  const result = await http("POST", "/api/auth/login", {
    body: {
      username,
      password: "synthetic-test-password",
    },
  });

  assert.equal(result.status, 200);
  assert.match(result.cookie ?? "", /^nexusmed_session=/);
  return result.cookie;
}

async function keyPair() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  const publicInfo = await inspectLegacyPublicKey(keys);
  return { keys, ...publicInfo };
}

async function challenge(cookie, key) {
  return http("POST", "/api/keys/challenge", {
    cookie,
    body: { publicKeyJwk: key.publicKeyJwk },
  });
}

async function verify(cookie, data, proof) {
  return http("POST", "/api/keys/challenge/verify", {
    cookie,
    body: {
      challengeId: data.challengeId,
      proof,
    },
  });
}

function registryCount() {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM institution_public_keys"
  ).get().n;
}

test("real login cookie authorizes PoP and first registration", async () => {
  const cookie = await login();
  const me = await http("GET", "/api/auth/me", { cookie });

  assert.equal(me.status, 200);
  assert.equal(me.data.user.userId, "designated-org2");

  const key = await keyPair();
  const issued = await challenge(cookie, key);

  assert.equal(issued.status, 201);

  const proof = await createLegacyPoPProof(
    key.keys,
    issued.data
  );

  process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "true";

  try {
    const registered = await verify(cookie, issued.data, proof);
    assert.equal(registered.status, 201);
    assert.equal(registered.data.status, "key_registered");
    assert.equal(registryCount(), 1);

    const lookup = await http(
      "GET",
      "/api/keys/institutions/org2/active",
      { cookie }
    );

    assert.equal(lookup.status, 200);
    assert.equal(
      lookup.data.keyId,
      registered.data.key.keyId
    );
  } finally {
    process.env.NEXUSMED_KEY_REGISTRATION_ENABLED = "false";
    db.prepare("DELETE FROM institution_public_keys").run();
  }
});

test("different real session cannot redeem challenge", async () => {
  const firstCookie = await login();
  const secondCookie = await login();
  const key = await keyPair();

  const issued = await challenge(firstCookie, key);
  assert.equal(issued.status, 201);

  const proof = await createLegacyPoPProof(
    key.keys,
    issued.data
  );

  const denied = await verify(secondCookie, issued.data, proof);
  assert.equal(denied.status, 403);

  const allowed = await verify(firstCookie, issued.data, proof);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.registrationEnabled, false);
  assert.equal(registryCount(), 0);
});

test("real session of other receiver cannot enroll", async () => {
  const cookie = await login("staff-other");
  const key = await keyPair();
  const result = await challenge(cookie, key);

  assert.equal(result.status, 403);
});

test("revoked role invalidates existing session", async () => {
  const cookie = await login();

  db.prepare(`
    UPDATE role_assignments
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = 'designated-org2'
  `).run();

  try {
    const key = await keyPair();
    const denied = await challenge(cookie, key);
    assert.equal(denied.status, 401);
  } finally {
    db.prepare(`
      UPDATE role_assignments
      SET revoked_at = NULL
      WHERE user_id = 'designated-org2'
    `).run();
  }
});

test("missing session cookie denied", async () => {
  const key = await keyPair();
  const denied = await challenge(undefined, key);
  assert.equal(denied.status, 401);
});
