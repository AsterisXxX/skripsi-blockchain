import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fabricNetwork from "fabric-network";

const { Gateway, Wallets, DefaultEventHandlerStrategies } = fabricNetwork;

const here = path.dirname(fileURLToPath(import.meta.url));
const networkRoot = path.resolve(here, "../../../fabric-samples/test-network");

const orgRoot = path.join(
  networkRoot,
  "organizations/peerOrganizations/org1.example.com",
);

async function firstFile(directory) {
  const names = await fs.readdir(directory);
  const files = names.filter((name) => !name.startsWith("."));

  if (files.length !== 1) {
    throw new Error(`Harus ada tepat satu file di ${directory}`);
  }

  return path.join(directory, files[0]);
}

async function connectFabric() {
  const profilePath = path.join(orgRoot, "connection-org1.json");
  const profile = JSON.parse(await fs.readFile(profilePath, "utf8"));

  const adminPath = path.join(orgRoot, "users/Admin@org1.example.com/msp");

  const certPath = await firstFile(path.join(adminPath, "signcerts"));
  const keyPath = await firstFile(path.join(adminPath, "keystore"));

  const certificate = await fs.readFile(certPath, "utf8");
  const privateKey = await fs.readFile(keyPath, "utf8");

  const wallet = await Wallets.newInMemoryWallet();

  await wallet.put("org1-admin", {
    credentials: { certificate, privateKey },
    mspId: "Org1MSP",
    type: "X.509",
  });

  const gateway = new Gateway();

  await gateway.connect(profile, {
    wallet,
    identity: "org1-admin",
    discovery: {
      enabled: true,
      asLocalhost: true,
    },
    eventHandlerOptions: {
      strategy: DefaultEventHandlerStrategies.NETWORK_SCOPE_ALLFORTX,
      commitTimeout: 60,
    },
  });

  return gateway;
}

export async function getReferralFromFabric(referralId) {
  const gateway = await connectFabric();

  try {
    const network = await gateway.getNetwork("referralchannel");
    const contract = network.getContract("rujukan");

    const result = await contract.evaluateTransaction(
      "GetReferral",
      referralId,
    );

    return JSON.parse(result.toString());
  } finally {
    gateway.disconnect();
  }
}

export async function createReferralOnFabric({
  referralId,
  patientId,
  receiverId = "Org2MSP",
  documentHash,
  timestamp = new Date().toISOString(),
}) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(referralId || "")) {
    throw new Error("Referral ID tidak valid.");
  }

  if (!patientId || typeof patientId !== "string") {
    throw new Error("Patient ID wajib diisi.");
  }

  if (receiverId !== "Org2MSP") {
    throw new Error("Tujuan rujukan harus Org2MSP.");
  }

  if (!/^[a-f0-9]{64}$/.test(documentHash || "")) {
    throw new Error("Hash SHA-256 tidak valid.");
  }

  const gateway = await connectFabric();

  try {
    const network = await gateway.getNetwork("referralchannel");
    const contract = network.getContract("rujukan");

    const transaction = contract.createTransaction("CreateReferral");

    // Endorsement dari Org1 dan Org2.
    transaction.setEndorsingOrganizations("Org1MSP", "Org2MSP");

    const transactionId = transaction.getTransactionId();

    await transaction.submit(
      referralId,
      patientId,
      receiverId,
      documentHash,
      timestamp,
    );

    return {
      status: "committed",
      referralId,
      transactionId,
      documentHash,
    };
  } finally {
    gateway.disconnect();
  }
}
