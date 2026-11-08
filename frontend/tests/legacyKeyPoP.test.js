import test from "node:test";
import assert from "node:assert/strict";

import {
  webcrypto,
  createECDH,
  randomBytes,
  randomUUID,
  hkdfSync,
  createHmac,
} from "node:crypto";

import {
  inspectLegacyPublicKey,
  createLegacyPoPProof,
} from "../src/services/legacyKeyPoP.js";

globalThis.crypto ??= webcrypto;

test("browser PoP verifies against backend Node crypto", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  const { publicKeyJwk, fingerprint } =
    await inspectLegacyPublicKey(keys);

  assert.equal(keys.privateKey.extractable, false);
  assert.equal(publicKeyJwk.d, undefined);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);

  const server = createECDH("prime256v1");
  server.generateKeys();

  const nonce = randomBytes(32).toString("base64url");

  const challenge = {
    protocol: "NexusMed-KeyPoP-v1",
    challengeId: randomUUID(),
    institutionId: "org2",
    nonce,
    fingerprint,
    serverPublicKey:
      server.getPublicKey().toString("base64url"),
  };

  const proof = await createLegacyPoPProof(
    keys,
    challenge
  );

  const clientPoint = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(publicKeyJwk.x, "base64url"),
    Buffer.from(publicKeyJwk.y, "base64url"),
  ]);

  const shared = server.computeSecret(clientPoint);

  const hmacKey = Buffer.from(hkdfSync(
    "sha256",
    shared,
    Buffer.from(nonce),
    Buffer.from("NexusMed-KeyPoP-v1"),
    32
  ));

  const context = {
    protocol: challenge.protocol,
    challengeId: challenge.challengeId,
    institutionId: challenge.institutionId,
    nonce: challenge.nonce,
    fingerprint: challenge.fingerprint,
  };

  const expected = createHmac("sha256", hmacKey)
    .update(JSON.stringify(context))
    .digest("base64url");

  assert.equal(proof, expected);
});

test("mismatched fingerprint is rejected", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  await assert.rejects(
    createLegacyPoPProof(keys, {
      protocol: "NexusMed-KeyPoP-v1",
      challengeId: randomUUID(),
      institutionId: "org2",
      nonce: "test-nonce",
      fingerprint: "0".repeat(64),
      serverPublicKey: "invalid",
    }),
    /Fingerprint challenge tidak cocok/
  );
});

test("wrong institution cannot use Org2 PoP helper", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  await assert.rejects(
    createLegacyPoPProof(keys, {
      protocol: "NexusMed-KeyPoP-v1",
      institutionId: "org3",
    }),
    /Challenge PoP tidak valid/
  );
});
