function equalBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;

  let difference = 0;

  for (let i = 0; i < a.byteLength; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

export async function verifyRegisteredKeyPair(
  storedKeys,
  registeredPublicKey
) {
  const privateKey = storedKeys?.privateKey;
  const localPublicKey = storedKeys?.publicKey;

  if (
    privateKey?.type !== "private" ||
    localPublicKey?.type !== "public" ||
    registeredPublicKey?.type !== "public"
  ) {
    throw new Error("Pasangan kunci tidak valid.");
  }

  const localJwk = await crypto.subtle.exportKey(
    "jwk",
    localPublicKey
  );

  const registryJwk = await crypto.subtle.exportKey(
    "jwk",
    registeredPublicKey
  );

  if (
    localJwk.kty !== "EC" ||
    localJwk.crv !== "P-256" ||
    localJwk.x !== registryJwk.x ||
    localJwk.y !== registryJwk.y
  ) {
    throw new Error(
      "Public key lokal tidak cocok dengan registry."
    );
  }

  // Membuktikan bahwa private key lokal benar-benar
  // berpasangan dengan public key yang terdaftar.
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  const fromLocalPrivate = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: ephemeral.publicKey },
      privateKey,
      256
    )
  );

  const fromRegisteredPublic = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: registeredPublicKey },
      ephemeral.privateKey,
      256
    )
  );

  if (!equalBytes(fromLocalPrivate, fromRegisteredPublic)) {
    throw new Error(
      "Private key lokal tidak cocok dengan public key registry."
    );
  }

  return true;
}
