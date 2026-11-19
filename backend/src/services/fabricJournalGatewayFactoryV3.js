/**
 * NexusMed M15 - closed Gateway factory.
 *
 * This is intentionally NOT a production
 * Fabric connection implementation.
 *
 * HTTP tests may mock this module, but the
 * default behavior must always fail closed.
 *
 * No credentials, wallet, Fabric SDK,
 * network access, or environment reads.
 */

export async function createJournalGatewayV3() {
  throw new Error("M15_GATEWAY_NOT_CONFIGURED");
}
