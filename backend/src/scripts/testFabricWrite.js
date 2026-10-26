import {
  createReferralOnFabric,
  getReferralFromFabric,
} from "../services/fabricService.js";

import { createHash, randomUUID } from "node:crypto";

async function main() {
  const referralId = `REF-NODE-${randomUUID()}`;
  const patientId = "PAT-NODE-DUMMY";

  const ciphertextDummy = Buffer.from("nexusmed-fabric-sdk-test");

  const documentHash = createHash("sha256")
    .update(ciphertextDummy)
    .digest("hex");

  try {
    console.log("=== FABRIC WRITE TEST ===");
    console.log("Referral ID:", referralId);
    console.log("Document Hash:", documentHash);

    const result = await createReferralOnFabric({
      referralId,
      patientId,
      documentHash,
    });

    console.log("\nHasil submit:");
    console.log(JSON.stringify(result, null, 2));

    const stored = await getReferralFromFabric(referralId);

    console.log("\nData dari ledger:");
    console.log(JSON.stringify(stored, null, 2));

    if (
      stored.referralId !== referralId ||
      stored.recordHash !== documentHash ||
      stored.patientId !== patientId
    ) {
      throw new Error("Data ledger tidak sesuai dengan input.");
    }

    console.log("\nPASS: Fabric write + read + hash match");
  } catch (error) {
    console.error("\nFAIL:", error.message);
    process.exitCode = 1;
  }
}

main();
