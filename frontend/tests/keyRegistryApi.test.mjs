import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getActiveReceiverKey } from "../src/services/keyRegistryApi.js";

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

const keyPair = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  false,
  ["deriveBits"]
);

const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

const point = Buffer.concat([
  Buffer.from([0x04]),
  decodeBase64Url(jwk.x),
  decodeBase64Url(jwk.y),
]);

const fingerprint = createHash("sha256")
  .update(point)
  .digest("hex");

const validResponse = {
  keyId: "synthetic-key-001",
  institutionId: "test-org2",
  version: 1,
  fingerprint,
  publicKeyJwk: jwk,
};

const originalFetch = globalThis.fetch;

function mockResponse(data, status = 200) {
  let calledUrl = null;
  let calledOptions = null;

  globalThis.fetch = async (url, options) => {
    calledUrl = url;
    calledOptions = options;

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    };
  };

  return {
    getRequest() {
      return { url: calledUrl, options: calledOptions };
    },
  };
}

try {
  await test("Valid registered public key accepted", async () => {
    const mock = mockResponse(validResponse);

    const result = await getActiveReceiverKey("test-org2");

    assert.equal(result.keyId, "synthetic-key-001");
    assert.equal(result.institutionId, "test-org2");
    assert.equal(result.fingerprint, fingerprint);
    assert.equal(result.publicKey.type, "public");
    assert.equal(result.publicKey.algorithm.name, "ECDH");
    assert.equal(result.publicKey.algorithm.namedCurve, "P-256");

    const request = mock.getRequest();

    assert.equal(
      request.url,
      "/api/keys/institutions/test-org2/active"
    );
    assert.equal(request.options.credentials, "include");
    assert.equal(request.options.cache, "no-store");
  });

  await test("Incorrect fingerprint rejected", async () => {
    mockResponse({
      ...validResponse,
      fingerprint: "0".repeat(64),
    });

    await assert.rejects(
      getActiveReceiverKey("test-org2"),
      /Fingerprint public key tidak cocok/
    );
  });

  await test("Wrong institution rejected", async () => {
    mockResponse({
      ...validResponse,
      institutionId: "test-org3",
    });

    await assert.rejects(
      getActiveReceiverKey("test-org2"),
      /Metadata public key registry tidak valid/
    );
  });

  await test("Private JWK component rejected", async () => {
    mockResponse({
      ...validResponse,
      publicKeyJwk: {
        ...jwk,
        d: "synthetic-private-material",
      },
    });

    await assert.rejects(
      getActiveReceiverKey("test-org2"),
      /Format public key ECDH tidak valid/
    );
  });

  await test("HTTP 401 fails closed", async () => {
    mockResponse({ error: "Unauthorized" }, 401);

    await assert.rejects(
      getActiveReceiverKey("test-org2"),
      /HTTP 401/
    );
  });

  await test("HTTP 404 fails closed", async () => {
    mockResponse({ error: "Key not found" }, 404);

    await assert.rejects(
      getActiveReceiverKey("test-org2"),
      /HTTP 404/
    );
  });

  await test("Invalid institution ID rejected before fetch", async () => {
    globalThis.fetch = async () => {
      throw new Error("Fetch must not be called");
    };

    await assert.rejects(
      getActiveReceiverKey("../invalid"),
      /Institution ID tidak valid/
    );
  });

  await test("Invalid key version rejected", async () => {
    mockResponse({
      ...validResponse,
      version: 0,
    });

    await assert.rejects(
      getActiveReceiverKey("test-org2"),
      /Metadata public key registry tidak valid/
    );
  });

} finally {
  globalThis.fetch = originalFetch;
}

console.log("=== FINAL RESULT ===");
console.log(`${passed}/8 PASS; ${failed} FAIL`);

if (failed > 0) process.exitCode = 1;
