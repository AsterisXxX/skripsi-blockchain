const API_URL = "/api";

export async function getInstitutions() {
  const response = await fetch(`${API_URL}/admin/institutions`, {
    method: "GET",
    credentials: "include",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal mengambil data institusi.");
  }

  return data;
}

export async function getUsers() {
  const response = await fetch(`${API_URL}/admin/users`, {
    method: "GET",
    credentials: "include",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal mengambil data pengguna.");
  }

  return data;
}

export async function getAuditLogs() {
  const response = await fetch(`${API_URL}/admin/audit-logs`, {
    method: "GET",
    credentials: "include",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal mengambil audit logs.");
  }

  return data;
}

export async function suspendUser(userId) {
  const response = await fetch(
    `${API_URL}/admin/users/${encodeURIComponent(userId)}/suspend`,
    {
      method: "PATCH",
      credentials: "include",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal suspend pengguna.");
  }

  return data;
}

export async function reactivateUser(userId) {
  const response = await fetch(
    `${API_URL}/admin/users/${encodeURIComponent(userId)}/reactivate`,
    {
      method: "PATCH",
      credentials: "include",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal mengaktifkan pengguna.");
  }

  return data;
}

export async function revokeUserRole(userId) {
  const response = await fetch(
    `${API_URL}/admin/users/${encodeURIComponent(userId)}/revoke-role`,
    {
      method: "PATCH",
      credentials: "include",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal mencabut role.");
  }

  return data;
}

export async function assignUserRole(userId) {
  const response = await fetch(
    `${API_URL}/admin/users/${encodeURIComponent(userId)}/assign-role`,
    {
      method: "PATCH",
      credentials: "include",
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal memberikan role.");
  }

  return data;
}
