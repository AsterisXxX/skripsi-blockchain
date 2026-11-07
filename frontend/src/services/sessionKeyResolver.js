import { requireReceiverIdentity } from "./keyIdentity.js";
import { loadInstitutionKey } from "./institutionKeyStorage.js";
import { getActiveReceiverKey } from "./keyRegistryApi.js";
import { verifyRegisteredKeyPair } from "./keyPairVerification.js";

export async function resolveSessionKeys(
  user,
  { receiverInstitutionId } = {}
) {
  if (!user || typeof user.role !== "string") {
    throw new Error("Sesi pengguna tidak valid.");
  }

  // Pengirim hanya membutuhkan public key penerima.
  // Tidak boleh memuat private key dari IndexedDB.
  if (user.role === "org1") {
    if (!receiverInstitutionId) {
      throw new Error("Institusi penerima belum dikonfigurasi.");
    }

    const registered = await getActiveReceiverKey(
      receiverInstitutionId
    );

    return {
      mode: "registry",
      role: "org1",
      institutionId: registered.institutionId,
      keyId: registered.keyId,
      publicKey: registered.publicKey,
      privateKey: null,
    };
  }

  // Penerima memerlukan identitas institusi yang valid.
  if (user.role === "org2") {
    const identity = requireReceiverIdentity(user);

    const registered = await getActiveReceiverKey(
      identity.institutionId
    );

    const stored = await loadInstitutionKey(
      user,
      registered.keyId
    );

    if (!stored) {
      throw new Error(
        "Private key terdaftar tidak tersedia pada browser ini."
      );
    }

    await verifyRegisteredKeyPair(
      stored.keys,
      registered.publicKey
    );

    return {
      mode: "registry",
      role: "org2",
      institutionId: identity.institutionId,
      keyId: registered.keyId,
      publicKey: registered.publicKey,
      privateKey: stored.keys.privateKey,
    };
  }

  throw new Error("Role tidak memiliki akses key lifecycle.");
}
