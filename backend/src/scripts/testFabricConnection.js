import { getReferralFromFabric } from "../services/fabricService.js";

async function main() {
  try {
    const id = "REF-FAB-TEST-1793024609";

    console.log("Menghubungkan backend ke Fabric...");
    console.log("Mencari rujukan:", id);

    const referral = await getReferralFromFabric(id);

    console.log("KONEKSI BERHASIL");
    console.log(JSON.stringify(referral, null, 2));
  } catch (error) {
    console.error("KONEKSI GAGAL:", error.message);
    process.exitCode = 1;
  }
}

main();
