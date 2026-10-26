import "dotenv/config";
import { createHash } from "node:crypto";
import { minioClient, BUCKET } from "../config/minio.js";
import { getReferralFromFabric } from "../services/fabricService.js";

const referralId = process.argv[2] || "REF-HYBRID-003";

async function main() {
  const objectKey = `referrals/${referralId}.json`;

  console.log("=== HYBRID INTEGRITY TEST ===");
  console.log("Referral ID:", referralId);

  // 1. Download dokumen langsung dari MinIO
  const stream = await minioClient.getObject(BUCKET, objectKey);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const document = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  if (document.referralId !== referralId) {
    throw new Error("Referral ID MinIO tidak sesuai.");
  }

  // 2. Hitung ulang SHA-256 dari ciphertext MinIO
  const ciphertext = Buffer.from(document.payload.ciphertext, "base64");

  const calculatedHash = createHash("sha256").update(ciphertext).digest("hex");

  // 3. Baca hash referensi dari ledger Fabric
  const ledger = await getReferralFromFabric(referralId);

  console.log("Hash MinIO  :", calculatedHash);
  console.log("Hash Fabric :", ledger.recordHash);

  // 4. Bandingkan keduanya
  if (calculatedHash !== ledger.recordHash) {
    throw new Error("FAIL: Integritas ciphertext tidak valid!");
  }

  if (document.payload.documentHash !== calculatedHash) {
    throw new Error("FAIL: Hash di metadata MinIO tidak sesuai!");
  }

  console.log("PASS: Integritas ciphertext terverifikasi.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
