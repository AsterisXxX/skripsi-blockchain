import {
  inspectLegacyPublicKey,
  createLegacyPoPProof,
} from "./legacyKeyPoP.js";

import {
  getActiveReceiverKey,
} from "./keyRegistryApi.js";

import {
  loadInstitutionKey,
  saveInstitutionKey,
} from "./institutionKeyStorage.js";

import {
  verifyRegisteredKeyPair,
} from "./keyPairVerification.js";

import {
  bindLegacyKeyToRegistry,
} from "./legacyKeyBinding.js";

import {
  requireReceiverIdentity,
} from "./keyIdentity.js";

function readLegacyKeys() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nexusmed-keys", 1);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("hospital-keys")) {
        db.close();
        reject(new Error("Legacy key store tidak tersedia."));
        return;
      }

      const tx = db.transaction("hospital-keys", "readonly");
      const get = tx.objectStore("hospital-keys").get("org2-demo");

      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => reject(get.error);

      tx.oncomplete = () => db.close();
      tx.onabort = () => db.close();
    };
  });
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || `HTTP ${response.status}`
    );
  }

  return data;
}

async function inspectRegistry(institutionId) {
  const response = await fetch(
    `/api/keys/institutions/${encodeURIComponent(institutionId)}/active`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );

  if (response.status === 404) return false;

  if (!response.ok) {
    throw new Error(
      `Registry lookup failed: HTTP ${response.status}`
    );
  }

  return true;
}

async function bindExistingKey({
  user,
  keys,
  fingerprint,
}) {
  const registered = await getActiveReceiverKey("org2");

  return bindLegacyKeyToRegistry({
    user,
    keys,
    fingerprint,
    registered,
    loadInstitutionKey,
    saveInstitutionKey,
    verifyRegisteredKeyPair,
  });
}

/**
 * Explicit enrollment only.
 * Never invoke automatically during login or page load.
 */
export async function enrollLegacyOrg2Key(user) {
  const identity = requireReceiverIdentity(user);

  if (identity.institutionId !== "org2") {
    throw new Error("Enrollment hanya tersedia untuk Org2.");
  }

  const keys = await readLegacyKeys();

  if (!keys) {
    throw new Error(
      "Legacy key org2-demo tidak ditemukan. " +
      "Jangan membuat kunci baru secara otomatis."
    );
  }

  const { publicKeyJwk, fingerprint } =
    await inspectLegacyPublicKey(keys);

  // Recovery comes first, without a registration attempt.
  if (await inspectRegistry("org2")) {
    return bindExistingKey({
      user,
      keys,
      fingerprint,
    });
  }

  const challenge = await postJson(
    "/api/keys/challenge",
    { publicKeyJwk },
  );

  const proof = await createLegacyPoPProof(
    keys,
    challenge,
  );

  const result = await postJson(
    "/api/keys/challenge/verify",
    {
      challengeId: challenge.challengeId,
      proof,
    },
  );

  if (
    result.status === "proof_verified" &&
    result.registrationEnabled === false
  ) {
    return {
      status: "proof_verified_not_registered",
      institutionId: "org2",
    };
  }

  if (
    result.status !== "key_registered" ||
    !result.key?.keyId ||
    result.key.institutionId !== "org2" ||
    result.key.fingerprint !== fingerprint
  ) {
    throw new Error(
      "Respons registrasi tidak sesuai. " +
      "Periksa registry sebelum mencoba kembali."
    );
  }

  // If local storage fails, a later call enters the
  // existing-registry recovery path above.
  return bindExistingKey({
    user,
    keys,
    fingerprint,
  });
}
