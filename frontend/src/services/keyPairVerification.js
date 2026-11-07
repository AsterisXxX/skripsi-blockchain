function equalBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;

  let difference = 0;

  for (let i = 0; i < a.byteLength; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

function isP256Key(key, type) {
  return (
    key?.type === type &&
    key.algorithm?.name === "ECDH" &&
    key.algorithm?.namedCurve === "P-256"
  );
}

export async function verifyRegisteredKeyPair(
  storedKeys,
  registeredPublicKey
) {
  const privateKey = storedKeys?.privateKey;
  const localPublicKey = storedKeys?.publicKey;

  if (
    !isP256Key(privateKey, "private") ||
    !isP256Key(localPublicKey, "public") ||
    !isP256Key(registeredPublicKey, "public")
  ) {
    throw new Error("Pasangan kunci tidak valid.");
  }

  // Kunci ephemeral hanya dipakai untuk pembuktian ECDH.
  // Tidak disimpan dan tidak dikirim ke backend.
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );

  const derive = async (privateKey, publicKey) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: publicKey },
        privateKey,
        256
      )
    );

  const fromLocalPrivate = await derive(
    privateKey,
    ephemeral.publicKey
  );

  const fromLocalPublic = await derive(
    ephemeral.privateKey,
    localPublicKey
  );

  if (!equalBytes(fromLocalPrivate, fromLocalPublic)) {
    throw new Error(
      "Private key lokal tidak cocok dengan public key lokal."
    );
  }

  const fromRegisteredPublic = await derive(
    ephemeral.privateKey,
    registeredPublicKey
  );

  if (!equalBytes(fromLocalPrivate, fromRegisteredPublic)) {
    throw new Error(
      "Public key lokal tidak cocok dengan registry."
    );
  }

  return true;
}
