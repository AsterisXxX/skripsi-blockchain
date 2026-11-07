const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function requireId(value, name) {
  if (
    typeof value !== "string" ||
    !ID_PATTERN.test(value)
  ) {
    throw new Error(`${name} tidak valid.`);
  }

  return value;
}

export function requireReceiverIdentity(user) {
  if (!user || user.role !== "org2") {
    throw new Error("Sesi penerima tidak valid.");
  }

  return {
    userId: requireId(user.userId, "User ID"),
    institutionId: requireId(
      user.institutionId,
      "Institution ID"
    ),
  };
}

export function createInstitutionKeyId({
  institutionId,
  keyId,
}) {
  const institution = requireId(
    institutionId,
    "Institution ID"
  );

  const key = requireId(keyId, "Key ID");

  return `v2:institution:${institution}:key:${key}`;
}

export const LEGACY_KEY_ID = "org2-demo";
