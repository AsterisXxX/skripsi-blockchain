const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function base64UrlToBytes(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value)
  ) {
    throw new Error("Koordinat public key tidak valid.");
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=");

  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyFingerprint(jwk, expectedFingerprint) {
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);

  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);

  const digest = await crypto.subtle.digest("SHA-256", point);

  if (toHex(new Uint8Array(digest)) !== expectedFingerprint) {
    throw new Error("Fingerprint public key tidak cocok.");
  }
}

export async function getActiveReceiverKey(institutionId) {
  if (
    typeof institutionId !== "string" ||
    !ID_PATTERN.test(institutionId)
  ) {
    throw new Error("Institution ID tidak valid.");
  }

  const response = await fetch(
    `/api/keys/institutions/${encodeURIComponent(institutionId)}/active`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `Public key registry gagal: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (
    data.institutionId !== institutionId ||
    !ID_PATTERN.test(data.keyId ?? "") ||
    !Number.isSafeInteger(data.version) ||
    data.version < 1 ||
    !SHA256_PATTERN.test(data.fingerprint ?? "")
  ) {
    throw new Error("Metadata public key registry tidak valid.");
  }

  const jwk = data.publicKeyJwk;

  if (
    jwk?.kty !== "EC" ||
    jwk?.crv !== "P-256" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string" ||
    jwk.d !== undefined
  ) {
    throw new Error("Format public key ECDH tidak valid.");
  }

  await verifyFingerprint(jwk, data.fingerprint);

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  return {
    keyId: data.keyId,
    institutionId: data.institutionId,
    version: data.version,
    fingerprint: data.fingerprint,
    publicKey,
  };
}
