import db from "../config/database.js";

export function findAllInstitutions() {
  return db.prepare(`
    SELECT
      id, name, msp_id, status,
      can_send, can_receive,
      created_at, updated_at
    FROM institutions
    ORDER BY id
  `).all();
}

export function findAllUsers() {
  return db.prepare(`
    SELECT
      u.id,
      u.username,
      u.institution_id,
      u.status,
      u.created_at,
      GROUP_CONCAT(r.role, ', ') AS roles
    FROM users u
    LEFT JOIN role_assignments r
      ON r.user_id = u.id
      AND r.revoked_at IS NULL
    GROUP BY
      u.id,
      u.username,
      u.institution_id,
      u.status,
      u.created_at
    ORDER BY u.username
  `).all();
}

export function findRecentAuditLogs() {
  return db.prepare(`
    SELECT
      a.id,
      a.action,
      a.target_type,
      a.target_id,
      a.details,
      a.result,
      a.created_at,
      u.username AS actor
    FROM audit_logs a
    LEFT JOIN users u
      ON a.actor_user_id = u.id
    ORDER BY a.created_at DESC, a.rowid DESC
    LIMIT 100
  `).all();
}
