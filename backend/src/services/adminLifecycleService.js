import {
  findLifecycleUser,
  suspendStaffTransaction,
  findReactivationUser,
  reactivateStaffTransaction,
  findRevocationUser,
  revokeStaffRoleTransaction,
  findAssignmentUser,
  findAssignmentInstitution,
  findActiveUserRoles,
  assignStaffRoleTransaction,
} from "../repositories/adminLifecycleRepository.js";

import { AdminServiceError } from "./adminWriteService.js";

export function suspendStaff(userId, actorUserId) {
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new AdminServiceError(400, "User ID tidak valid.");
  }

  const user = findLifecycleUser(userId);

  if (!user) {
    throw new AdminServiceError(404, "Pengguna tidak ditemukan.");
  }

  if (
    user.id === actorUserId ||
    !["org1", "org2"].includes(user.institution_id)
  ) {
    throw new AdminServiceError(
      403,
      "Akun administrator tidak dapat disuspend melalui endpoint ini.",
    );
  }

  if (user.status !== "active") {
    throw new AdminServiceError(409, "Hanya akun aktif yang dapat disuspend.");
  }

  try {
    suspendStaffTransaction(user, actorUserId);
  } catch (error) {
    if (error.message === "USER_STATE_CHANGED") {
      throw new AdminServiceError(409, "Status pengguna telah berubah.");
    }

    throw error;
  }

  return {
    status: "success",
    message: "Pengguna berhasil disuspend.",
    user: {
      id: user.id,
      username: user.username,
      status: "suspended",
    },
  };
}

export function reactivateStaff(userId, actorUserId) {
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new AdminServiceError(400, "User ID tidak valid.");
  }

  const user = findReactivationUser(userId);

  if (!user) {
    throw new AdminServiceError(404, "Pengguna tidak ditemukan.");
  }

  if (
    !["org1", "org2"].includes(user.institution_id) ||
    user.status !== "suspended"
  ) {
    throw new AdminServiceError(
      409,
      "Hanya akun staf suspended yang dapat diaktifkan kembali.",
    );
  }

  if (user.institution_status !== "approved") {
    throw new AdminServiceError(403, "Institusi belum disetujui.");
  }

  try {
    reactivateStaffTransaction(user, actorUserId);
  } catch (error) {
    if (error.message === "USER_STATE_CHANGED") {
      throw new AdminServiceError(
        409,
        "Status pengguna atau institusi telah berubah.",
      );
    }

    throw error;
  }

  return {
    status: "success",
    user: {
      id: user.id,
      username: user.username,
      status: "active",
    },
  };
}

export function revokeStaffRole(userId, actorUserId) {
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new AdminServiceError(400, "User ID tidak valid.");
  }

  const user = findRevocationUser(userId);

  if (!user) {
    throw new AdminServiceError(404, "Pengguna tidak ditemukan.");
  }

  if (
    user.id === actorUserId ||
    !["org1", "org2"].includes(user.institution_id)
  ) {
    throw new AdminServiceError(
      403,
      "Role administrator tidak dapat dicabut melalui endpoint ini.",
    );
  }

  if (!user.role_assignment_id) {
    throw new AdminServiceError(
      409,
      "Pengguna tidak memiliki role staf aktif.",
    );
  }

  const expectedRole =
    user.institution_id === "org1" ? "referral_sender" : "referral_receiver";

  if (user.role !== expectedRole) {
    throw new AdminServiceError(409, "Role tidak sesuai dengan institusi.");
  }

  try {
    revokeStaffRoleTransaction(user, actorUserId);
  } catch (error) {
    if (
      error.message === "ROLE_STATE_CHANGED" ||
      error.message === "USER_STATE_CHANGED"
    ) {
      throw new AdminServiceError(
        409,
        "Status role atau pengguna telah berubah.",
      );
    }

    throw error;
  }

  return {
    status: "success",
    message: "Role pengguna berhasil dicabut.",
    user: {
      id: user.id,
      username: user.username,
      accountStatus: user.status,
      revokedRole: user.role,
    },
  };
}

export function assignStaffRole(userId, actorUserId) {
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new AdminServiceError(400, "User ID tidak valid.");
  }

  const user = findAssignmentUser(userId);

  if (!user) {
    throw new AdminServiceError(404, "Pengguna tidak ditemukan.");
  }

  if (
    user.id === actorUserId ||
    !["org1", "org2"].includes(user.institution_id)
  ) {
    throw new AdminServiceError(403, "Akun ini bukan akun staf yang didukung.");
  }

  if (user.status !== "active") {
    throw new AdminServiceError(
      409,
      "Hanya akun aktif yang dapat diberikan role.",
    );
  }

  const role =
    user.institution_id === "org1" ? "referral_sender" : "referral_receiver";

  const institution = findAssignmentInstitution(user.institution_id);

  if (
    !institution ||
    institution.status !== "approved" ||
    (role === "referral_sender" && institution.can_send !== 1) ||
    (role === "referral_receiver" && institution.can_receive !== 1)
  ) {
    throw new AdminServiceError(
      403,
      "Institusi tidak memiliki izin untuk role ini.",
    );
  }

  const activeRoles = findActiveUserRoles(userId);

  if (activeRoles.length > 0) {
    throw new AdminServiceError(409, "Pengguna masih memiliki role aktif.");
  }

  try {
    assignStaffRoleTransaction(user, role, actorUserId);
  } catch (error) {
    if (
      error.message === "USER_OR_PERMISSION_STATE_CHANGED" ||
      error.message === "USER_STATE_CHANGED" ||
      error.code?.startsWith("SQLITE_CONSTRAINT")
    ) {
      throw new AdminServiceError(
        409,
        "Status pengguna atau izin telah berubah.",
      );
    }

    throw error;
  }

  return {
    status: "success",
    message: "Role pengguna berhasil diberikan.",
    user: {
      id: user.id,
      username: user.username,
      accountStatus: "active",
      assignedRole: role,
    },
  };
}
