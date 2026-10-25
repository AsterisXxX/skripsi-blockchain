const fs = require("fs");
const crypto = require("crypto");

const generateUUID = () => crypto.randomUUID();

const generateFHIRReferral = () => {
  const patientId = generateUUID();
  const referralId = generateUUID();
  const senderOrgId = "Org1-RSPengirimMSP";
  const receiverOrgId = "Org2-RSPenerimaMSP";
  const fhirBundle = {
    resourceType: "Bundle",
    id: generateUUID(),
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${patientId}`,
        resource: {
          resourceType: "Patient",
          id: patientId,
          name: [
            {
              use: "official",
              family: "Sintetis",
              given: ["Budi", "Pasien"],
            },
          ],
          gender: "male",
          birthDate: "1985-10-15",
        },
      },
      {
        fullUrl: `urn:uuid:${referralId}`,
        resource: {
          resourceType: "ServiceRequest",
          id: referralId,
          status: "active",
          intent: "order",
          priority: "routine",
          subject: {
            reference: `urn:uuid:${patientId}`,
          },
          requester: {
            reference: `Organization/${senderOrgId}`,
            display: "FKTP Klinik Pratama",
          },
          performer: [
            {
              reference: `Organization/${receiverOrgId}`,
              display: "RS Rujukan Tingkat Lanjutan",
            },
          ],
          reasonCode: [
            {
              coding: [
                {
                  system: "http://snomed.info/sct",
                  code: "313183002",
                  display: "Referral for further care",
                },
              ],
              text: "Pasien membutuhkan observasi spesialis penyakit dalam terkait anomali laboratorium.",
            },
          ],
        },
      },
    ],
  };
  return fhirBundle;
};

const fhirData = generateFHIRReferral();
const jsonString = JSON.stringify(fhirData, null, 2);
const fileName = "dummy_rekam_medis_fhir.json";

fs.writeFileSync(fileName, jsonString);
console.log(`[+] File ${fileName} berhasil dibuat!`);
const hashSHA256 = crypto.createHash("sha256").update(jsonString).digest("hex");
console.log(`[+] Hash SHA-256 untuk Ledger On-Chain: \n    ${hashSHA256}`);
console.log(
  `\nSilakan gunakan nilai hash ini untuk parameter 'RecordHash' di Smart Contract!`,
);
