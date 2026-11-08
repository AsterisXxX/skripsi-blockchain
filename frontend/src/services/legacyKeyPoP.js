const encoder = new TextEncoder();

function decodeBase64Url(value) {
  if (typeof value !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Base64URL tidak valid.");
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    Math.ceil(base64.length / 4) * 4, "="
  );

  return Uint8Array.from(
    atob(padded),
    char => char.charCodeAt(0)
  );
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function hex(bytes) {
  return Array.from(bytes)
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function inspectLegacyPublicKey(keys) {
  if (
    keys?.privateKey?.type !== "private" ||
    keys.privateKey.extractable !== false ||
    keys.privateKey.algorithm?.name !== "ECDH" ||
    keys.privateKey.algorithm?.namedCurve !== "P-256" ||
    !keys.privateKey.usages?.includes("deriveBits") ||
    keys?.publicKey?.type !== "public" ||
    keys.publicKey.algorithm?.name !== "ECDH" ||
    keys.publicKey.algorithm?.namedCurve !== "P-256"
  ) {
    throw new Error("Pasangan kunci legacy tidak valid.");
  }

  const jwk = await crypto.subtle.exportKey(
    "jwk",
    keys.publicKey
  );

  const publicKeyJwk = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
  };

  if (
    publicKeyJwk.kty !== "EC" ||
    publicKeyJwk.crv !== "P-256"
  ) {
    throw new Error("Hanya EC P-256 yang diizinkan.");
  }

  const x = decodeBase64Url(publicKeyJwk.x);
  const y = decodeBase64Url(publicKeyJwk.y);

  if (x.length !== 32 || y.length !== 32) {
    throw new Error("Koordinat P-256 tidak valid.");
  }

  const point = new Uint8Array(65);
  point[0] = 4;
  point.set(x, 1);
  point.set(y, 33);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    point
  );

  return {
    publicKeyJwk,
    fingerprint: hex(new Uint8Array(digest)),
  };
}

export async function createLegacyPoPProof(keys, challenge) {
  if (
    challenge?.protocol !== "NexusMed-KeyPoP-v1" ||
    challenge?.institutionId !== "org2" ||
    typeof challenge.challengeId !== "string" ||
    typeof challenge.nonce !== "string" ||
    typeof challenge.fingerprint !== "string"
  ) {
    throw new Error("Challenge PoP tidak valid.");
  }

  const { fingerprint } =
    await inspectLegacyPublicKey(keys);

  if (challenge.fingerprint !== fingerprint) {
    throw new Error("Fingerprint challenge tidak cocok.");
  }

  const serverPoint = decodeBase64Url(
    challenge.serverPublicKey
  );

  if (
    serverPoint.length !== 65 ||
    serverPoint[0] !== 4
  ) {
    throw new Error("Server public key tidak valid.");
  }

  const serverPublicKey = await crypto.subtle.importKey(
    "raw",
    serverPoint,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: serverPublicKey },
    keys.privateKey,
    256
  );

  const hkdfMaterial = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveBits"]
  );

  const hmacBytes = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(challenge.nonce),
      info: encoder.encode("NexusMed-KeyPoP-v1"),
    },
    hkdfMaterial,
    256
  );

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    hmacBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Urutan properti wajib sama dengan backend.
  const context = {
    protocol: "NexusMed-KeyPoP-v1",
    challengeId: challenge.challengeId,
    institutionId: challenge.institutionId,
    nonce: challenge.nonce,
    fingerprint: challenge.fingerprint,
  };

  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(JSON.stringify(context))
  );

  return encodeBase64Url(
    new Uint8Array(signature)
  );
}
