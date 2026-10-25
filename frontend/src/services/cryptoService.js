const subtle = crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(data) {
  const bytes = new Uint8Array(data);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }

  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(data) {
  const digest = await subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateHospitalKeys() {
  return subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
}

async function deriveWrappingKey(privateKey, publicKey, salt) {
  const sharedSecret = await subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );

  const material = await subtle.importKey("raw", sharedSecret, "HKDF", false, [
    "deriveKey",
  ]);

  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("MedReferral-AES-KeyWrap-v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptFHIR(fhirData, receiverPublicKey) {
  const aesKey = await subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(fhirData));

  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintext,
  );

  const ephemeralKeys = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));

  const wrappingKey = await deriveWrappingKey(
    ephemeralKeys.privateKey,
    receiverPublicKey,
    salt,
  );

  const rawAesKey = await subtle.exportKey("raw", aesKey);

  const wrappedKey = await subtle.encrypt(
    { name: "AES-GCM", iv: wrapIv },
    wrappingKey,
    rawAesKey,
  );

  const ephemeralPublicKey = await subtle.exportKey(
    "jwk",
    ephemeralKeys.publicKey,
  );

  return {
    version: 1,
    algorithm: "AES-256-GCM + ECDH-P256 + HKDF-SHA256",
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    wrappedKey: toBase64(wrappedKey),
    wrapIv: toBase64(wrapIv),
    salt: toBase64(salt),
    ephemeralPublicKey,
    documentHash: await sha256(ciphertext),
  };
}

export async function decryptFHIR(payload, receiverPrivateKey, expectedHash) {
  const ciphertext = fromBase64(payload.ciphertext);

  const actualHash = await sha256(ciphertext);

  if (!expectedHash || actualHash !== expectedHash) {
    throw new Error("Integritas dokumen gagal! Hash SHA-256 tidak cocok.");
  }

  const ephemeralPublicKey = await subtle.importKey(
    "jwk",
    payload.ephemeralPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const wrappingKey = await deriveWrappingKey(
    receiverPrivateKey,
    ephemeralPublicKey,
    fromBase64(payload.salt),
  );

  const rawAesKey = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(payload.wrapIv),
    },
    wrappingKey,
    fromBase64(payload.wrappedKey),
  );

  const aesKey = await subtle.importKey("raw", rawAesKey, "AES-GCM", false, [
    "decrypt",
  ]);

  const plaintext = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(payload.iv),
    },
    aesKey,
    ciphertext,
  );

  return JSON.parse(decoder.decode(plaintext));
}
