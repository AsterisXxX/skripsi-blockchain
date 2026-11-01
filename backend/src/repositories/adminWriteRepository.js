import db from "../config/database.js";
import { randomUUID } from "node:crypto";

export function findInstitutionById(institutionId) {
  return db.prepare(`
    SELECT id, status, can_send, can_receive
    FROM institutions
    WHERE id = ?
  `).get(institutionId);
}

export function findUserByUsername(username) {
  return db.prepare(`
    SELECT id
    FROM users
    WHERE username = ?
  `).get(username);
}

export function createStaffWithRole({
  userId,
  username,
  passwordHash,
  institutionId,
  role,
  actorUserId,
}) {
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (
        id, username, password_hash, institution_id, status
      )
      VALUES (?, ?, ?, ?, 'active')
    `).run(userId, username, passwordHash, institutionId);

    db.prepare(`
      INSERT INTO role_assignments (
        id, user_id, role, assigned_by
      )
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), userId, role, actorUserId);

    db.prepare(`
      INSERT INTO audit_logs (
        id, actor_user_id, action,
        target_type, target_id, details, result
      )
      VALUES (?, ?, 'CREATE_USER', 'user', ?, ?, 'success')
    `).run(
      randomUUID(),
      actorUserId,
      userId,
      JSON.stringify({ username, institutionId, role }),
    );
  });

  transaction();
}
