import assert from "node:assert/strict";
import { convertToFHIR } from "../src/utils/fhirConverter.js";
const input = {
  referralId: "REF-PERMENKES-001",
  patientId: "PAT-001",
  patientName: "Pasien Simulasi",
  senderHospital: "Org1 - FKTP",
  receiverHospital: "Org2 - FKRTL",
  targetUnit: "Poli Penyakit Dalam",
  diagnosis: "Diagnosis kerja sintetis",
  complaints: "Keluhan sintetis",
  examination: "Temuan pemeriksaan sintetis",
  treatment: "Pemeriksaan awal sintetis",
  priority: "routine",
  reason: "Alasan sintetis",
  consentConfirmed: true,
};
const bundle = convertToFHIR(input);
assert.equal(bundle.resourceType, "Bundle");
assert.equal(bundle.type, "collection");
assert.equal(bundle.entry.length, 9);
assert.equal(new Set(bundle.entry.map((e) => e.fullUrl)).size, 9);
const urls = new Set(bundle.entry.map((e) => e.fullUrl));
function check(x) {
  if (!x || typeof x !== "object") return;
  if (x.reference)
    assert(urls.has(x.reference), `broken reference: ${x.reference}`);
  for (const v of Object.values(x)) {
    if (Array.isArray(v)) v.forEach(check);
    else if (v && typeof v === "object") check(v);
  }
}
bundle.entry.forEach((e) => check(e.resource));
for (const field of [
  "targetUnit",
  "diagnosis",
  "complaints",
  "examination",
  "treatment",
  "reason",
]) {
  assert.throws(() => convertToFHIR({ ...input, [field]: "" }), /wajib diisi/);
}
assert.throws(
  () => convertToFHIR({ ...input, consentConfirmed: false }),
  /persetujuan/,
);
assert.throws(
  () => convertToFHIR({ ...input, referralId: "illegal id" }),
  /Nomor rujukan/,
);
console.log(
  "PASS: 9 FHIR R4 resource instances, references, mandatory fields, consent simulation flag, ID format",
);
