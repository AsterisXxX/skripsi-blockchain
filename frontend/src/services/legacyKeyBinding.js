/**
 * Bind an existing non-extractable key pair to an institutional
 * public-key registry record.
 *
 * Dependencies are injected for deterministic testing.
 * Never overwrites an existing institutional key record.
 */
export async function bindLegacyKeyToRegistry({
  user,
  keys,
  fingerprint,
  registered,
  loadInstitutionKey,
  saveInstitutionKey,
  verifyRegisteredKeyPair,
}) {
  if (
    registered?.institutionId !== "org2" ||
    typeof registered.keyId !== "string" ||
    !registered.keyId ||
    registered.fingerprint !== fingerprint
  ) {
    throw new Error("Registry tidak cocok dengan key legacy.");
  }

  await verifyRegisteredKeyPair(
    keys,
    registered.publicKey,
  );

  const existing = await loadInstitutionKey(
    user,
    registered.keyId,
  );

  if (existing) {
    await verifyRegisteredKeyPair(
      existing.keys,
      registered.publicKey,
    );

    return {
      status: "already_bound",
      keyId: registered.keyId,
      institutionId: "org2",
    };
  }

  try {
    await saveInstitutionKey(
      user,
      registered.keyId,
      keys,
    );
  } catch (error) {
    // Concurrent enrollment may have stored the same key.
    // Re-read and cryptographically verify, never overwrite.
    const recovered = await loadInstitutionKey(
      user,
      registered.keyId,
    );

    if (!recovered) {
      throw new Error(
        "Penyimpanan key v2 belum terkonfirmasi. " +
        "Enrollment bisa dipulihkan tanpa rotasi key.",
        { cause: error },
      );
    }

    await verifyRegisteredKeyPair(
      recovered.keys,
      registered.publicKey,
    );

    return {
      status: "already_bound",
      keyId: registered.keyId,
      institutionId: "org2",
    };
  }

  const confirmed = await loadInstitutionKey(
    user,
    registered.keyId,
  );

  if (!confirmed) {
    throw new Error(
      "Key v2 tidak ditemukan setelah penyimpanan. " +
      "Jalankan recovery sebelum mencoba registrasi ulang.",
    );
  }

  await verifyRegisteredKeyPair(
    confirmed.keys,
    registered.publicKey,
  );

  return {
    status: "recovered",
    keyId: registered.keyId,
    institutionId: "org2",
  };
}
