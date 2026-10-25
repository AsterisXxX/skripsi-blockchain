const fs = require("fs");
const crypto = require("crypto");

const algorithm = "aes-256-gcm";
const symmetricKey = crypto.randomBytes(32);
const iv = crypto.randomBytes(16);

const inputFile = "dummy_rekam_medis_fhir.json";
const fhirData = fs.readFileSync(inputFile, "utf8");

const cipher = crypto.createCipheriv(algorithm, symmetricKey, iv);
let encryptedData = cipher.update(fhirData, "utf8", "hex");
encryptedData += cipher.final("hex");
const authTag = cipher.getAuthTag().toString("hex");

const e2eePayload = {
  referralId: "6c69dbaa-220c-490b-acbb-d1a5e0a75533",
  encryptionMethod: "Hybrid AES-256-GCM + CP-ABE",
  iv: iv.toString("hex"),
  authTag: authTag,
  ciphertext: encryptedData,
  cpAbeEncryptedKey: "SIMULASI_CPABE_CIPHERTEXT_DARI_KUNCI_AES",
  policy: "Org2MSP AND DokterSpesialis",
};

const outputFile = "cloud_payload_terenkripsi.json";
fs.writeFileSync(outputFile, JSON.stringify(e2eePayload, null, 2));

console.log(`[+] Proses Enkripsi E2EE Berhasil!`);
console.log(`[+] File siap diunggah ke Cloud: ${outputFile}`);
console.log(
  `[!] Kunci AES Asli (Simpan untuk tes dekripsi Org2 nanti): ${symmetricKey.toString("hex")}`,
);
