import Database from "better-sqlite3";
import {
  createECDH,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { registerFirstPublicKey } from "../src/services/keyRegistryService.js";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

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
    fingerprint TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    FOREIGN KEY (institution_id)
      REFERENCES institutions(id),
    UNIQUE (institution_id, version)
  );

  INSERT INTO institutions
  VALUES ('org2', 'approved', 1);
`);

let failures = 0;
const usedChallenges = new Set();

function check(name, condition) {
  console.log(`${name}: ${condition ? "PASS" : "FAIL"}`);
  if (!condition) failures++;
}

function makeKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();

  const point = ecdh.getPublicKey();

  return {
    ecdh,
    point,
    publicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url")
    }
  };
}

function makeChallenge(keys) {
  const server = createECDH("prime256v1");
  server.generateKeys();

  return {
    challengeId: randomUUID(),
    institutionId: "org2",
    nonce: randomBytes(32).toString("base64url"),
    fingerprint: createHash("sha256")
      .update(keys.point)
      .digest("hex"),
    publicKeyJwk: keys.publicKeyJwk,
    serverPublicKey: server.getPublicKey(),
    sharedSecret: server.computeSecret(keys.point)
  };
}

function makeProof(challenge, keys) {
  const shared = keys.ecdh.computeSecret(
    challenge.serverPublicKey
  );

  const key = Buffer.from(hkdfSync(
    "sha256",
    shared,
    Buffer.from(challenge.nonce),
    Buffer.from("NexusMed-KeyPoP-v1"),
    32
  ));

  return createHmac("sha256", key)
    .update(JSON.stringify({
      protocol: "NexusMed-KeyPoP-v1",
      challengeId: challenge.challengeId,
      institutionId: challenge.institutionId,
      nonce: challenge.nonce,
      fingerprint: challenge.fingerprint
    }))
    .digest();
}

function verifyAndRegister(challenge, proof) {
  if (usedChallenges.has(challenge.challengeId)) {
    throw new Error("Challenge already used");
  }

  usedChallenges.add(challenge.challengeId);

  const expectedKey = Buffer.from(hkdfSync(
    "sha256",
    challenge.sharedSecret,
    Buffer.from(challenge.nonce),
    Buffer.from("NexusMed-KeyPoP-v1"),
    32
  ));

  const expected = createHmac("sha256", expectedKey)
    .update(JSON.stringify({
      protocol: "NexusMed-KeyPoP-v1",
      challengeId: challenge.challengeId,
      institutionId: challenge.institutionId,
      nonce: challenge.nonce,
      fingerprint: challenge.fingerprint
    }))
    .digest();

  if (
    !Buffer.isBuffer(proof) ||
    proof.length !== expected.length ||
    !timingSafeEqual(proof, expected)
  ) {
    throw new Error("Invalid proof");
  }

  return registerFirstPublicKey(db, {
    institutionId: challenge.institutionId,
    publicKeyJwk: challenge.publicKeyJwk,
    fingerprint: challenge.fingerprint
  });
}

function rejected(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

try {
  const keys = makeKeys();
  const badKeys = makeKeys();

  const badChallenge = makeChallenge(keys);
  const wrongProof = makeProof(badChallenge, badKeys);

  check("Wrong proof rejected", rejected(() => {
    verifyAndRegister(badChallenge, wrongProof);
  }));

  check("No key after invalid proof",
    db.prepare(
      "SELECT COUNT(*) AS total FROM institution_public_keys"
    ).get().total === 0
  );

  const challenge = makeChallenge(keys);
  const correctProof = makeProof(challenge, keys);

  const result = verifyAndRegister(challenge, correctProof);

  check("Valid proof registers key", result.status === "active");

  check("Correct fingerprint persisted",
    db.prepare(
      "SELECT fingerprint FROM institution_public_keys"
    ).get().fingerprint === challenge.fingerprint
  );

  check("Replay rejected", rejected(() => {
    verifyAndRegister(challenge, correctProof);
  }));

  const anotherChallenge = makeChallenge(makeKeys());

  check("Duplicate registration rejected", rejected(() => {
    verifyAndRegister(
      anotherChallenge,
      makeProofForDuplicate(anotherChallenge)
    );
  }));

  check("Only one key persisted",
    db.prepare(
      "SELECT COUNT(*) AS total FROM institution_public_keys"
    ).get().total === 1
  );

  check("Database integrity",
    db.pragma("integrity_check", { simple: true }) === "ok"
  );

} finally {
  db.close();
}

function makeProofForDuplicate(challenge) {
  const key = Buffer.from(hkdfSync(
    "sha256",
    challenge.sharedSecret,
    Buffer.from(challenge.nonce),
    Buffer.from("NexusMed-KeyPoP-v1"),
    32
  ));

  return createHmac("sha256", key)
    .update(JSON.stringify({
      protocol: "NexusMed-KeyPoP-v1",
      challengeId: challenge.challengeId,
      institutionId: challenge.institutionId,
      nonce: challenge.nonce,
      fingerprint: challenge.fingerprint
    }))
    .digest();
}

console.log("=== FINAL RESULT ===");
console.log(failures === 0 ? "PASS" : `FAIL (${failures})`);

if (failures) process.exitCode = 1;
