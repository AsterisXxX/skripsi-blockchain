export function findDepartments(db) {
  return db.prepare(`
    SELECT
      d.id,
      d.name,
      d.institution_id,
      d.status,
      i.name AS institution_name
    FROM departments d
    JOIN institutions i ON i.id = d.institution_id
    ORDER BY i.name, d.name, d.id
  `).all();
}

export function findDepartmentMemberships(db) {
  return db.prepare(`
    SELECT
      uda.id AS assignment_id,
      u.id AS user_id,
      u.username,
      u.institution_id,
      u.status AS user_status,
      d.id AS department_id,
      d.name AS department_name,
      d.status AS department_status,
      i.status AS institution_status,
      i.can_receive,
      uda.assigned_at,
      (
        SELECT GROUP_CONCAT(ra.role, ', ')
        FROM role_assignments ra
        WHERE ra.user_id = u.id
          AND ra.revoked_at IS NULL
      ) AS roles,
      CASE WHEN
        u.status = 'active'
        AND i.status = 'approved'
        AND i.can_receive = 1
        AND d.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM role_assignments ra
          WHERE ra.user_id = u.id
            AND ra.role = 'referral_receiver'
            AND ra.revoked_at IS NULL
        )
      THEN 1 ELSE 0 END AS can_receive_referral
    FROM user_department_assignments uda
    JOIN users u ON u.id = uda.user_id
    JOIN departments d ON d.id = uda.department_id
    JOIN institutions i ON i.id = d.institution_id
    WHERE uda.revoked_at IS NULL
      AND u.institution_id = d.institution_id
    ORDER BY u.username, d.name, uda.id
  `).all();
}
