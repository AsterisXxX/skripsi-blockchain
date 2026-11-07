import {
  createInstitutionKeyId,
  requireReceiverIdentity,
} from "./keyIdentity.js";

const DB_NAME = "nexusmed-keys";
const DB_VERSION = 1;
const STORE_NAME = "hospital-keys";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB gagal dibuka."));
    request.onblocked = () =>
      reject(new Error("IndexedDB sedang diblokir."));
  });
}

function validateKeyPair(keys) {
  const publicKey = keys?.publicKey;
  const privateKey = keys?.privateKey;

  if (
    publicKey?.type !== "public" ||
    privateKey?.type !== "private" ||
    publicKey.algorithm?.name !== "ECDH" ||
    privateKey.algorithm?.name !== "ECDH" ||
    publicKey.algorithm?.namedCurve !== "P-256" ||
    privateKey.algorithm?.namedCurve !== "P-256" ||
    privateKey.extractable !== false ||
    !privateKey.usages?.includes("deriveBits")
  ) {
    throw new Error("Pasangan kunci ECDH P-256 tidak valid.");
  }
}

export async function loadInstitutionKey(user, keyId) {
  const { institutionId } = requireReceiverIdentity(user);

  const storageId = createInstitutionKeyId({
    institutionId,
    keyId,
  });

  const db = await openDatabase();

  try {
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(storageId);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });

    if (!record) return null;

    if (
      record.keyId !== keyId ||
      record.institutionId !== institutionId
    ) {
      throw new Error("Metadata penyimpanan kunci tidak sesuai.");
    }

    validateKeyPair(record.keys);

    return record;
  } finally {
    db.close();
  }
}

export async function saveInstitutionKey(user, keyId, keys) {
  const { institutionId } = requireReceiverIdentity(user);

  const storageId = createInstitutionKeyId({
    institutionId,
    keyId,
  });

  validateKeyPair(keys);

  const record = {
    schemaVersion: 2,
    institutionId,
    keyId,
    keys,
    createdAt: new Date().toISOString(),
  };

  const db = await openDatabase();

  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");

      // add() menolak duplikasi. Jangan gunakan put().
      const request = tx.objectStore(STORE_NAME).add(record, storageId);

      let requestError = null;

      request.onerror = () => {
        requestError = request.error;
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(requestError || tx.error || new Error("Transaksi IndexedDB gagal."));
      tx.onabort = () =>
        reject(requestError || tx.error || new Error("Transaksi IndexedDB dibatalkan."));
    });

    return {
      institutionId,
      keyId,
      createdAt: record.createdAt,
    };
  } finally {
    db.close();
  }
}
