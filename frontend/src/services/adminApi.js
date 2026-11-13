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

export async function getDepartments() {
  const response = await fetch("/api/admin/departments", {
    method: "GET",
    credentials: "include",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal mengambil daftar poli.");
  }

  return data;
}

export async function getDepartmentMemberships() {
  const response = await fetch(
    "/api/admin/department-memberships",
    {
      method: "GET",
      credentials: "include",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || "Gagal mengambil membership poli."
    );
  }

  return data;
}

export async function createDepartment(payload) {
  const response = await fetch("/api/admin/departments", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Gagal mendaftarkan poli.");
  }

  return data;
}

export async function assignDepartmentMembership({
  userId,
  departmentId,
}) {
  const response = await fetch(
    "/api/admin/department-memberships",
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId, departmentId }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || "Gagal memberikan membership poli."
    );
  }

  return data;
}

export async function revokeDepartmentMembership(assignmentId) {
  const response = await fetch(
    `/api/admin/department-memberships/${encodeURIComponent(assignmentId)}/revoke`,
    {
      method: "PATCH",
      credentials: "include",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || "Gagal mencabut membership poli."
    );
  }

  return data;
}
