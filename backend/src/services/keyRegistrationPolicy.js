/**
 * Key registration is disabled by default.
 * Production requires explicit operator opt-in.
 */
export function isKeyRegistrationEnabled(env = process.env) {
  return (
    ["production", "test"].includes(env.NODE_ENV) &&
    env.NEXUSMED_KEY_REGISTRATION_ENABLED === "true"
  );
}
