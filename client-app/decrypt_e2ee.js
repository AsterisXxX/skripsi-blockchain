const fs = require("fs");
const crypto = require("crypto");

const hexKey = process.argv[2];
if (!hexKey) {
  console.error("[-] Error: Kunci AES tidak ditemukan!");
  console.log("[-] Cara pakai: node decrypt_e2ee.js <KUNCI_AES_HEX>");
  process.exit(1);
}

const symmetricKey = Buffer.from(hexKey, "hex");

const inputFile = "cloud_payload_terenkripsi.json";
if (!fs.existsSync(inputFile)) {
  console.error(`[-] Error: File ${inputFile} tidak ditemukan!`);
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));

const iv = Buffer.from(payload.iv, "hex");
const authTag = Buffer.from(payload.authTag, "hex");
const ciphertext = payload.ciphertext;

try {
  const decipher = crypto.createDecipheriv("aes-256-gcm", symmetricKey, iv);
  decipher.setAuthTag(authTag);

  let decryptedData = decipher.update(ciphertext, "hex", "utf8");
  decryptedData += decipher.final("utf8");

  const outputFile = "hasil_dekripsi_org2.json";
  fs.writeFileSync(outputFile, decryptedData);

  console.log(
    `[+] Proses Dekripsi Berhasil! Data tidak dimanipulasi (Otentik).`,
  );
  console.log(`[+] File rekam medis berhasil dipulihkan di: ${outputFile}`);
} catch (error) {
  console.error(
    `[-] DEKRIPSI GAGAL! Kunci salah atau data telah diubah/tampered.`,
  );
  console.error(`Detail: ${error.message}`);
}
