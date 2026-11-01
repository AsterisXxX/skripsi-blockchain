import Database from "better-sqlite3";
import { createHash, createECDH } from "node:crypto";
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

  CREATE UNIQUE INDEX idx_active_key
  ON institution_public_keys(institution_id)
  WHERE status = 'active';

  INSERT INTO institutions VALUES
    ('org1', 'approved', 0),
    ('org2', 'approved', 1);
`);

let failures = 0;

function check(name, condition) {
  console.log(`${name}: ${condition ? "PASS" : "FAIL"}`);
  if (!condition) failures++;
}

function makeKey() {
  const key = createECDH("prime256v1");
  key.generateKeys();

  const point = key.getPublicKey();

  return {
    publicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url")
    },
    fingerprint: createHash("sha256")
      .update(point)
      .digest("hex")
  };
}

function rejected(action) {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

try {
  const first = makeKey();

  const registered = registerFirstPublicKey(db, {
    institutionId: "org2",
    ...first
  });

  check("First registration", registered.version === 1);
  check("Active status", registered.status === "active");

  check("Duplicate registration rejected", rejected(() => {
    registerFirstPublicKey(db, {
      institutionId: "org2",
      ...makeKey()
    });
  }));

  check("Unauthorized institution rejected", rejected(() => {
    registerFirstPublicKey(db, {
      institutionId: "org1",
      ...makeKey()
    });
  }));

  const count = db.prepare(`
    SELECT COUNT(*) AS total
    FROM institution_public_keys
  `).get().total;

  check("Only one key persisted", count === 1);
  check(
    "Database integrity",
    db.pragma("integrity_check", { simple: true }) === "ok"
  );

  console.log("=== FINAL RESULT ===");
  console.log(failures === 0 ? "PASS" : `FAIL (${failures})`);

  if (failures) process.exitCode = 1;
} finally {
  db.close();
}
