import assert from "node:assert/strict";

import {
  verifyRegisteredKeyPair
} from "../src/services/keyPairVerification.js";

const createPair = () =>
  crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

const original = await createPair();
const other = await createPair();

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

await test("Correct key pair accepted", async () => {
  assert.equal(
    await verifyRegisteredKeyPair(
      original,
      original.publicKey
    ),
    true
  );
});

await test("Wrong registered public key rejected", async () => {
  await assert.rejects(
    verifyRegisteredKeyPair(original, other.publicKey),
    /Public key lokal tidak cocok/
  );
});

await test("Wrong private key rejected", async () => {
  await assert.rejects(
    verifyRegisteredKeyPair(
      {
        publicKey: original.publicKey,
        privateKey: other.privateKey
      },
      original.publicKey
    ),
    /Private key lokal tidak cocok/
  );
});

await test("Missing private key rejected", async () => {
  await assert.rejects(
    verifyRegisteredKeyPair(
      { publicKey: original.publicKey },
      original.publicKey
    ),
    /Pasangan kunci tidak valid/
  );
});

console.log("=== FINAL RESULT ===");
console.log(`${passed}/4 PASS; ${failed} FAIL`);

if (failed) process.exitCode = 1;
