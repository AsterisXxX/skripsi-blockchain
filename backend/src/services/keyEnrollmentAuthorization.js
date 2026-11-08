/**
 * First institutional key enrollment:
 * restricted to one explicitly designated receiver account.
 *
 * Environment must be configured by the operator.
 */
export function canEnrollInstitutionKey(
  user,
  env = process.env,
) {
  return Boolean(
    user &&
    user.role === "org2" &&
    user.permission === "referral_receiver" &&
    user.institutionId === "org2" &&
    user.institution === "Org2MSP" &&
    typeof user.userId === "string" &&
    user.userId.length > 0 &&
    typeof env.NEXUSMED_KEY_ENROLLMENT_USER_ID === "string" &&
    env.NEXUSMED_KEY_ENROLLMENT_USER_ID.length > 0 &&
    user.userId === env.NEXUSMED_KEY_ENROLLMENT_USER_ID
  );
}
