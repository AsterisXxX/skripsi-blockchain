const API_URL = "http://localhost:3001/api";

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
