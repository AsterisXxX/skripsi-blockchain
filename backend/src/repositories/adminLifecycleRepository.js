import db from "../config/database.js";
import { randomUUID } from "node:crypto";

export function findLifecycleUser(userId) {
  return db
    .prepare(
      `
    SELECT id, username, status, institution_id
    FROM users
    WHERE id = ?
  `,
    )
    .get(userId);
}

export function suspendStaffTransaction(user, actorUserId) {
  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `
      UPDATE users
      SET
        status = 'suspended',
        session_version = session_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'active'
        AND institution_id = ?
    `,
      )
      .run(user.id, user.institution_id);

    if (result.changes !== 1) {
      throw new Error("USER_STATE_CHANGED");
    }

    db.prepare(
      `
      INSERT INTO audit_logs (
        id, actor_user_id, action,
        target_type, target_id, details, result
      )
      VALUES (?, ?, 'SUSPEND_USER', 'user', ?, ?, 'success')
    `,
    ).run(
      randomUUID(),
      actorUserId,
      user.id,
      JSON.stringify({
        username: user.username,
        previousStatus: "active",
        newStatus: "suspended",
      }),
    );
  });

  transaction();
}

export function findReactivationUser(userId) {
  return db
    .prepare(
      `
    SELECT
      u.id,
      u.username,
      u.status,
      u.institution_id,
      i.status AS institution_status
    FROM users u
    LEFT JOIN institutions i
      ON i.id = u.institution_id
    WHERE u.id = ?
  `,
    )
    .get(userId);
}

export function reactivateStaffTransaction(user, actorUserId) {
  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `
      UPDATE users
      SET
        status = 'active',
        session_version = session_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'suspended'
        AND institution_id IN (
          SELECT id
          FROM institutions
          WHERE status = 'approved'
        )
    `,
      )
      .run(user.id);

    if (result.changes !== 1) {
      throw new Error("USER_STATE_CHANGED");
    }

    db.prepare(
      `
      INSERT INTO audit_logs (
        id, actor_user_id, action,
        target_type, target_id, details, result
      )
      VALUES (?, ?, 'REACTIVATE_USER', 'user', ?, ?, 'success')
    `,
    ).run(
      randomUUID(),
      actorUserId,
      user.id,
      JSON.stringify({
        username: user.username,
        previousStatus: "suspended",
        newStatus: "active",
      }),
    );
  });

  transaction();
}

export function findRevocationUser(userId) {
  return db
    .prepare(
      `
    SELECT
      u.id,
      u.username,
      u.status,
      u.institution_id,
      r.id AS role_assignment_id,
      r.role
    FROM users u
    LEFT JOIN role_assignments r
      ON r.user_id = u.id
      AND r.revoked_at IS NULL
      AND r.role IN ('referral_sender', 'referral_receiver')
    WHERE u.id = ?
  `,
    )
    .get(userId);
}

export function revokeStaffRoleTransaction(user, actorUserId) {
  const transaction = db.transaction(() => {
    const result = db
      .prepare(
        `
      UPDATE role_assignments
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL
    `,
      )
      .run(user.role_assignment_id, user.id);

    if (result.changes !== 1) {
      throw new Error("ROLE_STATE_CHANGED");
    }

    const updated = db
      .prepare(
        `
      UPDATE users
      SET
        session_version = session_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND institution_id = ?
    `,
      )
      .run(user.id, user.institution_id);

    if (updated.changes !== 1) {
      throw new Error("USER_STATE_CHANGED");
    }

    db.prepare(
      `
      INSERT INTO audit_logs (
        id,
        actor_user_id,
        action,
        target_type,
        target_id,
        details,
        result
      )
      VALUES (?, ?, 'REVOKE_ROLE', 'user', ?, ?, 'success')
    `,
    ).run(
      randomUUID(),
      actorUserId,
      user.id,
      JSON.stringify({
        username: user.username,
        institutionId: user.institution_id,
        role: user.role,
        previousState: "active",
        newState: "revoked",
      }),
    );
  });

  transaction();
}

export function findAssignmentUser(userId) {
  return db
    .prepare(
      `
    SELECT id, username, status, institution_id
    FROM users
    WHERE id = ?
  `,
    )
    .get(userId);
}

export function findAssignmentInstitution(institutionId) {
  return db
    .prepare(
      `
    SELECT id, status, can_send, can_receive
    FROM institutions
    WHERE id = ?
  `,
    )
    .get(institutionId);
}

export function findActiveUserRoles(userId) {
  return db
    .prepare(
      `
    SELECT role
    FROM role_assignments
    WHERE user_id = ?
      AND revoked_at IS NULL
  `,
    )
    .all(userId);
}

export function assignStaffRoleTransaction(user, role, actorUserId) {
  const transaction = db.transaction(() => {
    const currentUser = db
      .prepare(
        `
      SELECT status, session_version, institution_id
      FROM users
      WHERE id = ?
    `,
      )
      .get(user.id);

    const institution = db
      .prepare(
        `
      SELECT status, can_send, can_receive
      FROM institutions
      WHERE id = ?
    `,
      )
      .get(user.institution_id);

    const existingRole = db
      .prepare(
        `
      SELECT 1
      FROM role_assignments
      WHERE user_id = ?
        AND revoked_at IS NULL
    `,
      )
      .get(user.id);

    if (
      !currentUser ||
      currentUser.status !== "active" ||
      currentUser.institution_id !== user.institution_id ||
      !institution ||
      institution.status !== "approved" ||
      (role === "referral_sender" && institution.can_send !== 1) ||
      (role === "referral_receiver" && institution.can_receive !== 1) ||
      existingRole
    ) {
      throw new Error("USER_OR_PERMISSION_STATE_CHANGED");
    }

    db.prepare(
      `
      INSERT INTO role_assignments (
        id, user_id, role, assigned_by
      )
      VALUES (?, ?, ?, ?)
    `,
    ).run(randomUUID(), user.id, role, actorUserId);

    const updated = db
      .prepare(
        `
      UPDATE users
      SET
        session_version = session_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'active'
        AND session_version = ?
    `,
      )
      .run(user.id, currentUser.session_version);

    if (updated.changes !== 1) {
      throw new Error("USER_STATE_CHANGED");
    }

    db.prepare(
      `
      INSERT INTO audit_logs (
        id, actor_user_id, action,
        target_type, target_id, details, result
      )
      VALUES (?, ?, 'ASSIGN_ROLE', 'user', ?, ?, 'success')
    `,
    ).run(
      randomUUID(),
      actorUserId,
      user.id,
      JSON.stringify({
        username: user.username,
        institutionId: user.institution_id,
        role,
        previousState: "revoked_or_unassigned",
        newState: "active",
      }),
    );
  });

  transaction();
}
