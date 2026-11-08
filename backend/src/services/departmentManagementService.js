import { randomUUID } from "node:crypto";

export class DepartmentManagementError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "DepartmentManagementError";
    this.statusCode = statusCode;
  }
}

const VALID_ID = /^[a-z][a-z0-9_]{2,79}$/;

export function registerDepartment(
  db,
  { id, name, institutionId, actorUserId }
) {
  if (
    typeof id !== "string" ||
    !VALID_ID.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 100 ||
    typeof institutionId !== "string" ||
    !VALID_ID.test(institutionId) ||
    typeof actorUserId !== "string" ||
    !actorUserId
  ) {
    throw new DepartmentManagementError(
      "Data pendaftaran poli tidak valid."
    );
  }

  const cleanName = name.trim();

  return db.transaction(() => {
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
      throw new DepartmentManagementError(
        "Akses administrator tidak valid.",
        403
      );
    }

    const institution = db.prepare(`
      SELECT id
      FROM institutions
      WHERE id = ?
        AND status = 'approved'
        AND can_receive = 1
    `).get(institutionId);

    if (!institution) {
      throw new DepartmentManagementError(
        "Institusi tujuan tidak berwenang menerima rujukan.",
        403
      );
    }

    const existing = db.prepare(`
      SELECT id
      FROM departments
      WHERE id = ?
    `).get(id);

    if (existing) {
      throw new DepartmentManagementError(
        "ID poli sudah terdaftar.",
        409
      );
    }

    const sameName = db.prepare(`
      SELECT id
      FROM departments
      WHERE institution_id = ?
        AND LOWER(name) = LOWER(?)
    `).get(institutionId, cleanName);

    if (sameName) {
      throw new DepartmentManagementError(
        "Nama poli sudah terdaftar pada institusi ini.",
        409
      );
    }

    db.prepare(`
      INSERT INTO departments (
        id, institution_id, name, status
      ) VALUES (?, ?, ?, 'active')
    `).run(id, institutionId, cleanName);

    db.prepare(`
      INSERT INTO audit_logs (
        id, actor_user_id, action,
        target_type, target_id, details, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      actorUserId,
      "CREATE_DEPARTMENT",
      "department",
      id,
      JSON.stringify({
        institutionId,
        departmentName: cleanName
      }),
      "success"
    );

    return {
      status: "success",
      department: {
        id,
        name: cleanName,
        institution_id: institutionId,
        status: "active"
      }
    };
  })();
}
