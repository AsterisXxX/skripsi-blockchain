const API_URL = "/api";

// Production synthetic referral testing is disabled by default.
const syntheticReferralEnabled =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_SYNTHETIC_REFERRALS === "true";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error || `Request gagal: HTTP ${response.status}`,
    );
    error.status = response.status;
    error.data = result;
    throw error;
  }

  return result;
}

export async function checkBackend() {
  return request("/health");
}

export async function login(username, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function getSession() {
  return request("/auth/me");
}

export async function logout() {
  return request("/auth/logout", {
    method: "POST",
  });
}

export async function uploadReferral(referralId, payload, patientId, targetDepartmentId) {
  if (!syntheticReferralEnabled) {
    throw new Error("Upload MinIO hanya tersedia pada development lokal.");
  }

  return request("/referrals", {
    method: "POST",
    body: JSON.stringify({
        referralId,
        patientId,
        payload,
        targetDepartmentId,
      }),
  });
}

export async function getStoredReferral(referralId) {
  if (!import.meta.env.DEV) {
    throw new Error("Pengambilan MinIO hanya tersedia pada development lokal.");
  }

  return request(`/referrals/${encodeURIComponent(referralId)}`);
}

export async function verifyHybridReferral(referralId) {
  if (!import.meta.env.DEV) {
    throw new Error("Pengujian Fabric hanya tersedia pada development lokal.");
  }

  try {
    return await request(
      `/referrals/${encodeURIComponent(referralId)}/verified`,
    );
  } catch (error) {
    if (error.data?.status === "integrity_failed") {
      return error.data;
    }
    throw error;
  }
}

export async function getVerifiedReferral(referralId) {
  if (!syntheticReferralEnabled) {
    throw new Error("Penerimaan hybrid hanya tersedia pada development lokal.");
  }

  let result;

  try {
    result = await request(
      `/referrals/${encodeURIComponent(referralId)}/verified`,
    );
  } catch (error) {
    if (error.data?.status === "integrity_failed") {
      throw new Error(
        "Integritas gagal! Hash ciphertext berbeda dari ledger Fabric.",
        { cause: error },
      );
    }
    throw error;
  }

  if (result.verified !== true || !result.payload) {
    throw new Error("Rujukan belum berhasil diverifikasi.");
  }

  return result;
}
