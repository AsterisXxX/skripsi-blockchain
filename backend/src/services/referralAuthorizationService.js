/**
 * NexusMed — Recipient Department Authorization
 *
 * Checks current database permissions.
 *
 * IMPORTANT:
 * - userId must come from an authenticated server session.
 * - receiverInstitutionId and targetDepartmentId must come
 *   from a trusted, stored referral record.
 * - Never trust client-supplied recipient attributes alone.
 *
 * This provides application-layer RBAC, not cryptographic
 * isolation between departments of the same institution.
 */
export function canReceiveReferral(
  db,
  {
    userId,
    receiverInstitutionId,
    targetDepartmentId,
  },
) {
  if (
    typeof userId !== "string" ||
    !userId ||
    typeof receiverInstitutionId !== "string" ||
    !receiverInstitutionId ||
    typeof targetDepartmentId !== "string" ||
    !targetDepartmentId
  ) {
    return false;
  }

  const permitted = db.prepare(`
    SELECT 1
    FROM users u
    JOIN institutions i
      ON i.id = u.institution_id
    JOIN departments d
      ON d.institution_id = i.id
    JOIN user_department_assignments uda
      ON uda.user_id = u.id
      AND uda.department_id = d.id
      AND uda.revoked_at IS NULL
    WHERE u.id = ?
      AND u.status = 'active'
      AND i.id = ?
      AND i.status = 'approved'
      AND i.can_receive = 1
      AND d.id = ?
      AND d.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM role_assignments ra
        WHERE ra.user_id = u.id
          AND ra.role = 'referral_receiver'
          AND ra.revoked_at IS NULL
      )
    LIMIT 1
  `).get(
    userId,
    receiverInstitutionId,
    targetDepartmentId,
  );

  return Boolean(permitted);
}
