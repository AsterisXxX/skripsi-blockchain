/**
 * M15 offline-only contract boundary.
 *
 * This function intentionally NEVER creates a real
 * Hyperledger Fabric Gateway or contract.
 *
 * HTTP tests must explicitly mock this module.
 */
export function createOfflineFabricContractCandidateV3() {
  throw new Error("M15_OFFLINE_CONTRACT_NOT_CONFIGURED");
}
