export function convertToFHIR(form) {
  const required = [
    "referralId",
    "patientId",
    "patientName",
    "senderHospital",
    "receiverHospital",
    "reason",
  ];

  for (const key of required) {
    if (!String(form[key] ?? "").trim()) {
      throw new Error(`Data ${key} wajib diisi.`);
    }
  }

  const patientUuid = crypto.randomUUID();
  const senderUuid = crypto.randomUUID();
  const receiverUuid = crypto.randomUUID();
  const requestUuid = crypto.randomUUID();

  const patientRef = `urn:uuid:${patientUuid}`;
  const senderRef = `urn:uuid:${senderUuid}`;
  const receiverRef = `urn:uuid:${receiverUuid}`;

  const patient = {
    resourceType: "Patient",
    id: patientUuid,
    identifier: [
      {
        system: "https://example.org/identifier/patient",
        value: form.patientId.trim(),
      },
    ],
    name: [
      {
        text: form.patientName.trim(),
      },
    ],
  };

  const sender = {
    resourceType: "Organization",
    id: senderUuid,
    name: form.senderHospital.trim(),
  };

  const receiver = {
    resourceType: "Organization",
    id: receiverUuid,
    name: form.receiverHospital.trim(),
  };

  const serviceRequest = {
    resourceType: "ServiceRequest",
    id: requestUuid,
    identifier: [
      {
        system: "https://example.org/identifier/referral",
        value: form.referralId.trim(),
      },
    ],
    status: "active",
    intent: "order",
    priority: form.priority || "routine",
    code: {
      text: "Permintaan rujukan medis",
    },
    subject: {
      reference: patientRef,
    },
    authoredOn: new Date().toISOString(),
    requester: {
      reference: senderRef,
    },
    performer: [
      {
        reference: receiverRef,
      },
    ],
    reasonCode: [
      {
        text: form.reason.trim(),
      },
    ],
  };

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: [
      { fullUrl: patientRef, resource: patient },
      { fullUrl: senderRef, resource: sender },
      { fullUrl: receiverRef, resource: receiver },
      {
        fullUrl: `urn:uuid:${requestUuid}`,
        resource: serviceRequest,
      },
    ],
  };
}
