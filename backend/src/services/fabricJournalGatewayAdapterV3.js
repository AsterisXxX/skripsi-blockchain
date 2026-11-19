/**
 * M15 isolated Gateway adapter candidate.
 *
 * Does not import fabric-network or connectFabric.
 * Requires caller-injected gatewayFactory.
 *
 * Does not authorize retry or registry commit.
 */

import {
  decideFabricJournalPathV3,
} from "./fabricJournalDowngradeGuardV3.js";

import {
  dispatchFabricJournalCandidateV3,
} from "./fabricJournalDispatcherCandidateV3.js";

export async function executeFabricJournalGatewayV3({
  gatewayFactory,
  ...input
} = {}) {
  // Selection happens before requesting a Gateway.
  const selection = decideFabricJournalPathV3({
    db: input.db,
    referralId: input.referralId,
    mode: input.mode ?? "disabled",
  });

  if (selection.path === "blocked") {
    return Object.freeze({
      path: "blocked",
      status: "pending_review",
      allowFabricRetry: false,
      allowRegistryCommit: false,
    });
  }

  if (selection.path === "legacy") {
    // Do not execute the legacy service here.
    return Object.freeze({
      path: "legacy_selected",
      allowFabricRetry: false,
      allowRegistryCommit: false,
    });
  }

  if (typeof gatewayFactory !== "function") {
    throw new Error("JOURNAL_GATEWAY_FACTORY_REQUIRED");
  }

  // Gateway lifecycle is isolated from the dispatcher.
  let gateway;

  try {
    // Do not preserve or log raw Gateway exceptions.
    try {
      gateway = await gatewayFactory();

      if (
        !gateway ||
        typeof gateway.getNetwork !== "function" ||
        typeof gateway.disconnect !== "function"
      ) {
        throw new Error("INVALID_GATEWAY");
      }

      const network = await gateway.getNetwork(
        "referralchannel"
      );

      if (
        !network ||
        typeof network.getContract !== "function"
      ) {
        throw new Error("INVALID_NETWORK");
      }

      const contract = network.getContract("rujukan");

      if (
        !contract ||
        typeof contract.createTransaction !== "function"
      ) {
        throw new Error("INVALID_CONTRACT");
      }

      return await dispatchFabricJournalCandidateV3({
        ...input,
        mode: "prepare_only",
        contract,
      });
    } catch {
      // Journal may already contain a prepared TxID.
      // Never infer that submission failed definitively.
      throw new Error("FABRIC_JOURNAL_OPERATION_UNCONFIRMED");
    }
  } finally {
    if (gateway) {
      try {
        await gateway.disconnect();
      } catch {
        // Cleanup error must not expose SDK internals.
        // No retry or commit is authorized.
      }
    }
  }
}
