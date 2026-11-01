import {
  findAllInstitutions,
  findAllUsers,
  findRecentAuditLogs,
} from "../repositories/adminReadRepository.js";

export function listInstitutions() {
  const institutions = findAllInstitutions();

  return {
    status: "success",
    total: institutions.length,
    institutions,
  };
}

export function listUsers() {
  const users = findAllUsers();

  return {
    status: "success",
    total: users.length,
    users,
  };
}

export function listAuditLogs() {
  const rows = findRecentAuditLogs();

  const logs = rows.map((log) => ({
    id: log.id,
    actor: log.actor || "system",
    action: log.action,
    targetType: log.target_type,
    targetId: log.target_id,
    result: log.result,
    createdAt: log.created_at,
  }));

  return {
    status: "success",
    total: logs.length,
    logs,
  };
}
