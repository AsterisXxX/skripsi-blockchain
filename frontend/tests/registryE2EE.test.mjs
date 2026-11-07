import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  generateHospitalKeys,
  encryptFHIR,
  decryptFHIR,
} from "../src/services/cryptoService.js";

import {
  saveInstitutionKey,
  loadInstitutionKey,
} from "../src/services/institutionKeyStorage.js";

import { getActiveReceiverKey } from "../src/services/keyRegistryApi.js";

const receiver = {
  userId: "synthetic-receiver-001",
  institutionId: "test-org2",
  role: "org2",
};

const keyId = "synthetic-key-001";

let passed = 0;
let failed = 0;

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

function fingerprintOf(jwk) {
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);

  return createHash("sha256").update(point).digest("hex");
}

const keys = await generateHospitalKeys();
const publicJwk = await crypto.subtle.exportKey(
  "jwk",
  keys.publicKey
);

const originalFetch = globalThis.fetch;

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    keyId,
    institutionId: receiver.institutionId,
    version: 1,
    fingerprint: fingerprintOf(publicJwk),
    publicKeyJwk: publicJwk,
  }),
});

const syntheticFHIR = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "synthetic-patient-001",
        name: [{ text: "Pasien Simulasi" }],
      },
    },
  ],
};

let registryKey;
let encrypted;

try {
  await test("1. Save Org2 private key", async () => {
    await saveInstitutionKey(receiver, keyId, keys);

    const stored = await loadInstitutionKey(receiver, keyId);

    assert.equal(stored.keyId, keyId);
    assert.equal(stored.keys.privateKey.extractable, false);
  });

  await test("2. Fetch registered public key", async () => {
    registryKey = await getActiveReceiverKey("test-org2");

    assert.equal(registryKey.keyId, keyId);
    assert.equal(registryKey.institutionId, "test-org2");
    assert.equal(registryKey.fingerprint, fingerprintOf(publicJwk));
  });

  await test("3. Encrypt using registry public key", async () => {
    assert.ok(registryKey?.publicKey);

    encrypted = await encryptFHIR(
      syntheticFHIR,
      registryKey.publicKey
    );

    assert.equal(encrypted.version, 1);
    assert.equal(
      encrypted.algorithm,
      "AES-256-GCM + ECDH-P256 + HKDF-SHA256"
    );
    assert.match(encrypted.documentHash, /^[a-f0-9]{64}$/);
  });

  await test("4. Decrypt using stored Org2 private key", async () => {
    const stored = await loadInstitutionKey(receiver, keyId);

    const plaintext = await decryptFHIR(
      encrypted,
      stored.keys.privateKey,
      encrypted.documentHash
    );

    assert.deepEqual(plaintext, syntheticFHIR);
  });

  await test("5. Wrong private key rejected", async () => {
    const wrongKeys = await generateHospitalKeys();

    await assert.rejects(
      decryptFHIR(
        encrypted,
        wrongKeys.privateKey,
        encrypted.documentHash
      )
    );
  });

  await test("6. Invalid ciphertext hash rejected", async () => {
    await assert.rejects(
      decryptFHIR(
        encrypted,
        keys.privateKey,
        "0".repeat(64)
      ),
      /Integritas dokumen gagal/
    );
  });

} finally {
  globalThis.fetch = originalFetch;
}

console.log("=== FINAL RESULT ===");
console.log(`${passed}/6 PASS; ${failed} FAIL`);

if (failed > 0) process.exitCode = 1;
