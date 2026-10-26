// HL7 FHIR R4 (4.0.1) Bundle collection for synthetic referral data.
// Mapping informed by Permenkes 16/2024 Pasal 17; not a formal referral document.
export function convertToFHIR(form) {
  const required = {
    referralId: "Nomor rujukan",
    patientId: "Nomor pasien",
    patientName: "Nama pasien",
    senderHospital: "Faskes pengirim",
    receiverHospital: "Faskes penerima",
    targetUnit: "Unit layanan tujuan",
    diagnosis: "Diagnosis kerja",
    complaints: "Keluhan",
    examination: "Hasil pemeriksaan",
    treatment: "Tindakan awal",
    reason: "Alasan rujukan",
  };
  for (const [key, label] of Object.entries(required)) {
    if (!String(form[key] ?? "").trim())
      throw new Error(`${label} wajib diisi.`);
  }
  if (form.consentConfirmed !== true) {
    throw new Error(
      "Konfirmasi persetujuan rujukan pasien (simulasi) wajib dicentang.",
    );
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(form.referralId.trim())) {
    throw new Error(
      "Nomor rujukan hanya boleh berisi huruf, angka, _ atau - (maks. 80 karakter). ",
    );
  }
  const ids = Object.fromEntries(
    [
      "patient",
      "sender",
      "receiver",
      "service",
      "condition",
      "complaint",
      "exam",
      "procedure",
      "request",
    ].map((name) => [name, crypto.randomUUID()]),
  );
  const ref = (name) => `urn:uuid:${ids[name]}`;
  const text = (key) => form[key].trim();
  const now = new Date().toISOString();
  const patient = {
    resourceType: "Patient",
    id: ids.patient,
    identifier: [
      {
        system: "https://example.org/nexusmed/patient-id",
        value: text("patientId"),
      },
    ],
    name: [{ text: text("patientName") }],
  };
  const sender = {
    resourceType: "Organization",
    id: ids.sender,
    name: text("senderHospital"),
  };
  const receiver = {
    resourceType: "Organization",
    id: ids.receiver,
    name: text("receiverHospital"),
  };
  const service = {
    resourceType: "HealthcareService",
    id: ids.service,
    active: true,
    providedBy: { reference: ref("receiver") },
    name: text("targetUnit"),
  };
  const condition = {
    resourceType: "Condition",
    id: ids.condition,
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "active",
        },
      ],
    },
    subject: { reference: ref("patient") },
    code: { text: text("diagnosis") },
    recordedDate: now,
  };
  const obs = (which, label, content) => ({
    resourceType: "Observation",
    id: ids[which],
    status: "final",
    code: { text: label },
    subject: { reference: ref("patient") },
    effectiveDateTime: now,
    valueString: content,
  });
  const complaint = obs(
    "complaint",
    "Keluhan utama (narasi sintetis)",
    text("complaints"),
  );
  const exam = obs(
    "exam",
    "Temuan pemeriksaan (narasi sintetis)",
    text("examination"),
  );
  const procedure = {
    resourceType: "Procedure",
    id: ids.procedure,
    status: "completed",
    subject: { reference: ref("patient") },
    code: { text: text("treatment") },
    performedDateTime: now,
  };
  const request = {
    resourceType: "ServiceRequest",
    id: ids.request,
    identifier: [
      {
        system: "https://example.org/nexusmed/referral-id",
        value: text("referralId"),
      },
    ],
    status: "active",
    intent: "order",
    priority: form.priority === "urgent" ? "urgent" : "routine",
    code: { text: "Permintaan rujukan medis rawat jalan" },
    subject: { reference: ref("patient") },
    authoredOn: now,
    requester: { reference: ref("sender") },
    performer: [{ reference: ref("service") }],
    reasonCode: [{ text: text("reason") }],
    reasonReference: [{ reference: ref("condition") }],
    supportingInfo: [
      { reference: ref("complaint") },
      { reference: ref("exam") },
      { reference: ref("procedure") },
    ],
  };
  const resources = [
    ["patient", patient],
    ["sender", sender],
    ["receiver", receiver],
    ["service", service],
    ["condition", condition],
    ["complaint", complaint],
    ["exam", exam],
    ["procedure", procedure],
    ["request", request],
  ];
  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: now,
    entry: resources.map(([name, resource]) => ({
      fullUrl: ref(name),
      resource,
    })),
  };
}
