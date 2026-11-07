import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { resolveSessionKeys } from "../src/services/sessionKeyResolver.js";
import { saveInstitutionKey } from "../src/services/institutionKeyStorage.js";

const receiver = {
  userId: "synthetic-org2-user",
  institutionId: "synthetic-org2",
  role: "org2",
};

const sender = {
  userId: "synthetic-org1-user",
  institutionId: "synthetic-org1",
  role: "org1",
};

const keys = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  false,
  ["deriveBits"]
);

const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);

const point = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, "base64url"),
  Buffer.from(jwk.y, "base64url"),
]);

const fingerprint = createHash("sha256")
  .update(point)
  .digest("hex");

let activeKeyId = "key-001";
let passed = 0;
let failed = 0;

const originalFetch = globalThis.fetch;

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    institutionId: receiver.institutionId,
    keyId: activeKeyId,
    version: 1,
    fingerprint,
    publicKeyJwk: jwk,
  }),
});

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`${name}: PASS`);
  } catch (error) {
    failed++;
    console.error(`${name}: FAIL — ${error.message}`);
  }
}

try {
  await test("Org1 resolves public key without private key", async () => {
    const result = await resolveSessionKeys(sender, {
      receiverInstitutionId: receiver.institutionId,
    });

    assert.equal(result.role, "org1");
    assert.equal(result.publicKey.type, "public");
    assert.equal(result.privateKey, null);

    // Tidak ada database IndexedDB yang dibuat.
    const databases = await indexedDB.databases();
    assert.equal(databases.length, 0);
  });

  await test("Org2 without local key fails closed", async () => {
    await assert.rejects(
      resolveSessionKeys(receiver),
      /Private key terdaftar tidak tersedia/
    );
  });

  await test("Org2 with matching key accepted", async () => {
    await saveInstitutionKey(receiver, activeKeyId, keys);

    const result = await resolveSessionKeys(receiver);

    assert.equal(result.role, "org2");
    assert.equal(result.privateKey.type, "private");
    assert.equal(result.privateKey.extractable, false);
  });

  await test("Missing receiver institution rejected", async () => {
    await assert.rejects(
      resolveSessionKeys(sender),
      /Institusi penerima belum dikonfigurasi/
    );
  });

  await test("Anonymous session rejected", async () => {
    await assert.rejects(
      resolveSessionKeys(null),
      /Sesi pengguna tidak valid/
    );
  });

  await test("Admin cannot load receiver keys", async () => {
    await assert.rejects(
      resolveSessionKeys({ role: "consortium_admin" }),
      /Role tidak memiliki akses/
    );
  });

  await test("Unknown registered key fails closed", async () => {
    activeKeyId = "key-002";

    await assert.rejects(
      resolveSessionKeys(receiver),
      /Private key terdaftar tidak tersedia/
    );
  });

} finally {
  globalThis.fetch = originalFetch;
}

console.log("=== FINAL RESULT ===");
console.log(`${passed}/7 PASS; ${failed} FAIL`);

if (failed) process.exitCode = 1;
