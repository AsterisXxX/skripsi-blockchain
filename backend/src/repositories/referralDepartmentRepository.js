/**
 * Departments available as referral destinations.
 *
 * Destination discovery is independent of staff membership.
 * Access to a particular referral is enforced separately.
 */
export function findAvailableReferralDepartments(
  db,
  receiverInstitutionId = "org2",
) {
  return db.prepare(`
    SELECT
      d.id,
      d.name,
      d.institution_id
    FROM departments d
    JOIN institutions i
      ON i.id = d.institution_id
    WHERE i.id = ?
      AND i.status = 'approved'
      AND i.can_receive = 1
      AND d.status = 'active'
    ORDER BY d.name, d.id
  `).all(receiverInstitutionId);
}
