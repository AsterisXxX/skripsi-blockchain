import { generateHospitalKeys } from "./cryptoService";

const DB_NAME = "nexusmed-keys";
const DB_VERSION = 1;
const STORE_NAME = "hospital-keys";
const KEY_ID = "org2-demo";

let pendingKeyLoad = null;

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
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      reject(new Error("Database IndexedDB sedang diblokir."));
    };
  });
}

async function readKeys() {
  const db = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(KEY_ID);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeKeys(keys) {
  const db = await openDatabase();

  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");

      tx.objectStore(STORE_NAME).put(keys, KEY_ID);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function loadOrCreateKeys() {
  const existing = await readKeys();

  if (existing) {
    if (
      existing.publicKey?.type !== "public" ||
      existing.privateKey?.type !== "private" ||
      existing.privateKey?.extractable !== false
    ) {
      throw new Error("Kunci Org2 tersimpan tidak valid.");
    }

    return {
      keys: existing,
      source: "indexeddb",
    };
  }

  const keys = await generateHospitalKeys();

  await writeKeys(keys);

  return {
    keys,
    source: "generated",
  };
}

export function getOrCreateHospitalKeys() {
  if (!pendingKeyLoad) {
    pendingKeyLoad = loadOrCreateKeys().finally(() => {
      pendingKeyLoad = null;
    });
  }

  return pendingKeyLoad;
}
