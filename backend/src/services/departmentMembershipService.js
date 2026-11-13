import { randomUUID } from "node:crypto";

export class DepartmentMembershipError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "DepartmentMembershipError";
    this.statusCode = statusCode;
  }
}

const VALID_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_DEPARTMENT_ID =
  /^[a-z][a-z0-9_]{2,79}$/;

function assertAdministrator(db, actorUserId) {
  if (
    typeof actorUserId !== "string" ||
    !VALID_UUID.test(actorUserId)
  ) {
    throw new DepartmentMembershipError(
      "Identitas administrator tidak valid.",
      403
    );
  }

  const actor = db.prepare(`
    SELECT 1
    FROM users u
    WHERE u.id = ?
      AND u.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM role_assignments ra
        WHERE ra.user_id = u.id
          AND ra.role = 'consortium_admin'
          AND ra.revoked_at IS NULL
      )
  `).get(actorUserId);

  if (!actor) {
    throw new DepartmentMembershipError(
      "Akses administrator tidak valid.",
      403
    );
  }
}

function recordAudit(
  db,
  { actorUserId, action, targetId, details }
) {
  db.prepare(`
    INSERT INTO audit_logs (
      id,
      actor_user_id,
      action,
      target_type,
      target_id,
      details,
      result
    )
    VALUES (?, ?, ?, ?, ?, ?, 'success')
  `).run(
    randomUUID(),
    actorUserId,
    action,
    "department_membership",
    targetId,
    JSON.stringify(details)
  );
}

export function assignDepartmentMembership(
  db,
  { userId, departmentId, actorUserId }
) {
  if (
    typeof userId !== "string" ||
    !VALID_UUID.test(userId) ||
    typeof departmentId !== "string" ||
    !VALID_DEPARTMENT_ID.test(departmentId)
  ) {
    throw new DepartmentMembershipError(
      "Data assignment poli tidak valid."
    );
  }

  return db.transaction(() => {
    assertAdministrator(db, actorUserId);

    const user = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.institution_id,
        u.status
      FROM users u
      WHERE u.id = ?
    `).get(userId);

    if (!user) {
      throw new DepartmentMembershipError(
        "Pengguna tidak ditemukan.",
        404
      );
    }

    if (
      user.status !== "active" ||
      user.id === actorUserId
    ) {
      throw new DepartmentMembershipError(
        "Pengguna tidak memenuhi syarat membership.",
        403
      );
    }

    const department = db.prepare(`
      SELECT
        d.id,
        d.name,
        d.institution_id,
        d.status,
        i.status AS institution_status,
        i.can_receive
      FROM departments d
      JOIN institutions i
        ON i.id = d.institution_id
      WHERE d.id = ?
    `).get(departmentId);

    if (!department) {
      throw new DepartmentMembershipError(
        "Poli tidak ditemukan.",
        404
      );
    }

    if (
      department.institution_id !== user.institution_id ||
      department.status !== "active" ||
      department.institution_status !== "approved" ||
      department.can_receive !== 1
    ) {
      throw new DepartmentMembershipError(
        "Poli dan institusi pengguna tidak memenuhi syarat.",
        403
      );
    }

    const role = db.prepare(`
      SELECT 1
      FROM role_assignments
      WHERE user_id = ?
        AND role = 'referral_receiver'
        AND revoked_at IS NULL
    `).get(userId);

    if (!role) {
      throw new DepartmentMembershipError(
        "Pengguna tidak memiliki role penerima aktif.",
        403
      );
    }

    const existing = db.prepare(`
      SELECT id
      FROM user_department_assignments
      WHERE user_id = ?
        AND department_id = ?
        AND revoked_at IS NULL
    `).get(userId, departmentId);

    if (existing) {
      throw new DepartmentMembershipError(
        "Membership poli sudah aktif.",
        409
      );
    }

    const assignmentId = randomUUID();

    try {
      db.prepare(`
        INSERT INTO user_department_assignments (
          id,
          user_id,
          department_id
        )
        VALUES (?, ?, ?)
      `).run(
        assignmentId,
        userId,
        departmentId
      );
    } catch (error) {
      if (error.code?.startsWith("SQLITE_CONSTRAINT")) {
        throw new DepartmentMembershipError(
          "Membership tidak dapat dibuat atau sudah aktif.",
          409
        );
      }

      throw error;
    }

    recordAudit(db, {
      actorUserId,
      action: "ASSIGN_DEPARTMENT_MEMBERSHIP",
      targetId: assignmentId,
      details: {
        userId,
        departmentId,
        institutionId: user.institution_id
      }
    });

    return {
      status: "success",
      membership: {
        id: assignmentId,
        user_id: userId,
        department_id: departmentId,
        institution_id: user.institution_id,
        active: true
      }
    };
  })();
}

export function revokeDepartmentMembership(
  db,
  { assignmentId, actorUserId }
) {
  if (
    typeof assignmentId !== "string" ||
    !VALID_UUID.test(assignmentId)
  ) {
    throw new DepartmentMembershipError(
      "ID assignment tidak valid."
    );
  }

  return db.transaction(() => {
    assertAdministrator(db, actorUserId);

    const membership = db.prepare(`
      SELECT
        uda.id,
        uda.user_id,
        uda.department_id,
        uda.revoked_at
      FROM user_department_assignments uda
      WHERE uda.id = ?
    `).get(assignmentId);

    if (!membership) {
      throw new DepartmentMembershipError(
        "Membership tidak ditemukan.",
        404
      );
    }

    if (membership.revoked_at !== null) {
      throw new DepartmentMembershipError(
        "Membership sudah dicabut.",
        409
      );
    }

    const result = db.prepare(`
      UPDATE user_department_assignments
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND revoked_at IS NULL
    `).run(assignmentId);

    if (result.changes !== 1) {
      throw new DepartmentMembershipError(
        "Status membership telah berubah.",
        409
      );
    }

    recordAudit(db, {
      actorUserId,
      action: "REVOKE_DEPARTMENT_MEMBERSHIP",
      targetId: assignmentId,
      details: {
        userId: membership.user_id,
        departmentId: membership.department_id
      }
    });

    return {
      status: "success",
      membership: {
        id: assignmentId,
        user_id: membership.user_id,
        department_id: membership.department_id,
        active: false
      }
    };
  })();
}
