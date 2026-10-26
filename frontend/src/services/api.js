const API_URL = "http://localhost:3001/api";

export async function checkBackend() {
  const response = await fetch(`${API_URL}/health`);

  if (!response.ok) {
    throw new Error("Backend tidak merespons");
  }

  return response.json();
}

export async function uploadReferral(referralId, payload, patientId) {
  if (!import.meta.env.DEV) {
    throw new Error("Upload MinIO hanya tersedia pada development lokal.");
  }

  const response = await fetch(`${API_URL}/referrals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      referralId,
      patientId,
      payload,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error || `Upload gagal dengan HTTP ${response.status}`,
    );
  }

  return result;
}

export async function getStoredReferral(referralId) {
  if (!import.meta.env.DEV) {
    throw new Error("Pengambilan MinIO hanya tersedia pada development lokal.");
  }

  const response = await fetch(
    `${API_URL}/referrals/${encodeURIComponent(referralId)}`,
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error || `Download gagal dengan HTTP ${response.status}`,
    );
  }

  return result;
}

export async function verifyHybridReferral(referralId) {
  if (!import.meta.env.DEV) {
    throw new Error("Pengujian Fabric hanya tersedia pada development lokal.");
  }

  const response = await fetch(
    `${API_URL}/referrals/${encodeURIComponent(referralId)}/verified`,
  );

  const result = await response.json();

  if (!response.ok && result.status !== "integrity_failed") {
    throw new Error(
      result.error || `Verifikasi gagal: HTTP ${response.status}`,
    );
  }

  return result;
}

export async function getVerifiedReferral(referralId) {
  if (!import.meta.env.DEV) {
    throw new Error("Penerimaan hybrid hanya tersedia pada development lokal.");
  }

  const response = await fetch(
    `${API_URL}/referrals/${encodeURIComponent(referralId)}/verified`,
  );

  const result = await response.json();

  if (!response.ok || result.verified !== true || !result.payload) {
    if (result.status === "integrity_failed") {
      throw new Error(
        "Integritas gagal! Hash ciphertext berbeda dari ledger Fabric.",
      );
    }

    throw new Error(result.error || "Rujukan belum berhasil diverifikasi.");
  }

  return result;
}
