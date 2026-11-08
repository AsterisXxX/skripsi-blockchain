import test from "node:test";
import assert from "node:assert/strict";

import {
  bindLegacyKeyToRegistry,
} from "../src/services/legacyKeyBinding.js";

function fixture() {
  const keys = { id: "legacy-private-key-pair" };
  const registered = {
    institutionId: "org2",
    keyId: "institutional-key-001",
    fingerprint: "a".repeat(64),
    publicKey: { id: "registry-public-key" },
  };

  let stored = null;
  let writes = 0;
  let failWrite = false;

  const params = {
    user: { role: "org2", institutionId: "org2" },
    keys,
    fingerprint: registered.fingerprint,
    registered,

    async loadInstitutionKey() {
      return stored ? { keys: stored } : null;
    },

    async saveInstitutionKey(_user, _keyId, value) {
      writes += 1;

      if (failWrite) {
        throw new Error("Synthetic IndexedDB failure");
      }

      if (stored) throw new Error("Duplicate key");

      stored = value;
    },

    async verifyRegisteredKeyPair(value) {
      if (value !== keys) {
        throw new Error("Key pair mismatch");
      }
    },
  };

  return {
    params,
    setFailWrite(value) {
      failWrite = value;
    },
    setStored(value) {
      stored = value;
    },
    get writes() {
      return writes;
    },
  };
}

test("new binding writes and verifies key", async () => {
  const f = fixture();
  const result = await bindLegacyKeyToRegistry(f.params);

  assert.equal(result.status, "recovered");
  assert.equal(f.writes, 1);
});

test("existing binding is not overwritten", async () => {
  const f = fixture();
  f.setStored(f.params.keys);

  const result = await bindLegacyKeyToRegistry(f.params);

  assert.equal(result.status, "already_bound");
  assert.equal(f.writes, 0);
});

test("storage failure can be recovered on retry", async () => {
  const f = fixture();
  f.setFailWrite(true);

  await assert.rejects(
    bindLegacyKeyToRegistry(f.params),
    /belum terkonfirmasi/
  );

  f.setFailWrite(false);

  const result = await bindLegacyKeyToRegistry(f.params);

  assert.equal(result.status, "recovered");
  assert.equal(f.writes, 2);
});

test("registration mismatch is rejected before storage", async () => {
  const f = fixture();
  f.params.registered.fingerprint = "b".repeat(64);

  await assert.rejects(
    bindLegacyKeyToRegistry(f.params),
    /Registry tidak cocok/
  );

  assert.equal(f.writes, 0);
});

test("existing wrong key cannot be overwritten", async () => {
  const f = fixture();
  f.setStored({ id: "different-key-pair" });

  await assert.rejects(
    bindLegacyKeyToRegistry(f.params),
    /Key pair mismatch/
  );

  assert.equal(f.writes, 0);
});
