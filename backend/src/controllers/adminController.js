import {
  registerDepartment,
  DepartmentManagementError,
} from "../services/departmentManagementService.js";

import db from "../config/database.js";
import {
  findDepartments,
  findDepartmentMemberships,
} from "../repositories/departmentReadRepository.js";

import {
  listInstitutions,
  listUsers,
  listAuditLogs,
} from "../services/adminReadService.js";
import {
  createStaffUser,
  AdminServiceError,
} from "../services/adminWriteService.js";
import {
  suspendStaff,
  reactivateStaff,
  revokeStaffRole,
  assignStaffRole,
} from "../services/adminLifecycleService.js";

export function createDepartment(req, res) {
  try {
    const result = registerDepartment(db, {
      id: req.body?.id,
      name: req.body?.name,
      institutionId: req.body?.institutionId,
      actorUserId: req.user?.userId,
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof DepartmentManagementError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    console.error("Department registration failed:", error.message);

    return res.status(500).json({
      error: "Gagal mendaftarkan poli.",
    });
  }
}

export function getDepartments(req, res) {
  try {
    const departments = findDepartments(db);
    return res.json({
      status: "success",
      total: departments.length,
      departments,
    });
  } catch {
    return res.status(500).json({
      error: "Gagal mengambil daftar poli.",
    });
  }
}

export function getDepartmentMemberships(req, res) {
  try {
    const memberships = findDepartmentMemberships(db);
    return res.json({
      status: "success",
      total: memberships.length,
      memberships,
    });
  } catch {
    return res.status(500).json({
      error: "Gagal mengambil membership poli.",
    });
  }
}

export function getInstitutions(req, res) {
  try {
    return res.json(listInstitutions());
  } catch {
    return res.status(500).json({
      error: "Gagal mengambil data institusi.",
    });
  }
}

export function getUsers(req, res) {
  try {
    return res.json(listUsers());
  } catch {
    return res.status(500).json({
      error: "Gagal mengambil data pengguna.",
    });
  }
}

export function getAuditLogs(req, res) {
  try {
    return res.json(listAuditLogs());
  } catch {
    return res.status(500).json({
      error: "Gagal mengambil audit logs.",
    });
  }
}

export function createUser(req, res) {
  try {
    const result = createStaffUser(req.body, req.user.userId);

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof AdminServiceError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    return res.status(500).json({
      error: "Gagal membuat pengguna.",
    });
  }
}

export function suspendUser(req, res) {
  try {
    const result = suspendStaff(req.params.id, req.user.userId);

    return res.json(result);
  } catch (error) {
    if (error instanceof AdminServiceError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    return res.status(500).json({
      error: "Gagal menonaktifkan pengguna.",
    });
  }
}

export function reactivateUser(req, res) {
  try {
    const result = reactivateStaff(req.params.id, req.user.userId);

    return res.json(result);
  } catch (error) {
    if (error instanceof AdminServiceError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    return res.status(500).json({
      error: "Gagal mengaktifkan pengguna.",
    });
  }
}

export function revokeUserRole(req, res) {
  try {
    const result = revokeStaffRole(req.params.id, req.user.userId);

    return res.json(result);
  } catch (error) {
    if (error instanceof AdminServiceError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    return res.status(500).json({
      error: "Gagal mencabut role pengguna.",
    });
  }
}

export function assignUserRole(req, res) {
  try {
    const result = assignStaffRole(req.params.id, req.user.userId);

    return res.json(result);
  } catch (error) {
    if (error instanceof AdminServiceError) {
      return res.status(error.statusCode).json({
        error: error.message,
      });
    }

    return res.status(500).json({
      error: "Gagal memberikan role pengguna.",
    });
  }
}
