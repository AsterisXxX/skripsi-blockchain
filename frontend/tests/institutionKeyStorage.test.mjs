import "fake-indexeddb/auto";
import assert from "node:assert/strict";
const {
  loadInstitutionKey,
  saveInstitutionKey,
} = await import("../src/services/institutionKeyStorage.js");

const receiver = {
  userId: "synthetic-user-001",
  institutionId: "test-org2",
  role: "org2",
};

const otherReceiver = {
  userId: "synthetic-user-002",
  institutionId: "test-org3",
  role: "org2",
};

const sender = {
  ...receiver,
  role: "org1",
};

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`${name}: PASS`);
  } catch (error) {
    console.error(`${name}: FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

const keys = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  false,
  ["deriveBits"],
);

// Seed a synthetic legacy record before testing v2 storage.
// fake-indexeddb keeps this database inside the Node.js test process.
const legacyRecord = {
  source: "synthetic-legacy",
  marker: "M07-LEGACY-PRESERVATION",
  keys,
};

{
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("nexusmed-keys", 1);

    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains("hospital-keys")) {
        database.createObjectStore("hospital-keys");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("hospital-keys", "readwrite");

      tx.objectStore("hospital-keys").add(
        legacyRecord,
        "org2-demo"
      );

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

await test("Save institution key", async () => {
  const result = await saveInstitutionKey(receiver, "key-001", keys);

  assert.equal(result.institutionId, "test-org2");
  assert.equal(result.keyId, "key-001");
});

await test("Load institution key", async () => {
  const record = await loadInstitutionKey(receiver, "key-001");

  assert.equal(record.keyId, "key-001");
  assert.equal(record.keys.privateKey.type, "private");
  assert.equal(record.keys.privateKey.extractable, false);
});

await test("Duplicate key ID rejected", async () => {
  await assert.rejects(
    saveInstitutionKey(receiver, "key-001", keys),
    error => error?.name === "ConstraintError"
  );

  const original = await loadInstitutionKey(receiver, "key-001");

  assert.equal(original.keys.privateKey.type, "private");
  assert.equal(original.keyId, "key-001");
});

await test("Sender role rejected", async () => {
  await assert.rejects(
    loadInstitutionKey(sender, "key-001"),
    /Sesi penerima tidak valid/
  );
});

await test("Other institution isolated by namespace", async () => {
  const result = await loadInstitutionKey(otherReceiver, "key-001");

  assert.equal(result, null);
});

await test("Legacy key untouched", async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("nexusmed-keys", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  try {
    const legacy = await new Promise((resolve, reject) => {
      const tx = db.transaction("hospital-keys", "readonly");
      const req = tx.objectStore("hospital-keys").get("org2-demo");

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    assert.ok(legacy, "Legacy record harus tetap tersedia");
    assert.equal(legacy.source, "synthetic-legacy");
    assert.equal(legacy.marker, "M07-LEGACY-PRESERVATION");
    assert.equal(legacy.keys.privateKey.type, "private");
    assert.equal(legacy.keys.privateKey.extractable, false);
  } finally {
    db.close();
  }
});

console.log("=== FINAL RESULT ===");
console.log(`${passed}/6 tests passed`);

if (passed !== 6) process.exitCode = 1;
