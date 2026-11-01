import { randomUUID } from "node:crypto";

export function registerFirstPublicKey(db, {
  institutionId,
  publicKeyJwk,
  fingerprint
}) {
  if (
    !institutionId ||
    !publicKeyJwk ||
    !/^[a-f0-9]{64}$/.test(fingerprint || "")
  ) {
    throw new Error("Data registrasi tidak valid.");
  }

  const register = db.transaction(() => {
    const institution = db.prepare(`
      SELECT id
      FROM institutions
      WHERE id = ?
        AND status = 'approved'
        AND can_receive = 1
    `).get(institutionId);

    if (!institution) {
      throw new Error("Institusi tidak berwenang.");
    }

    const existing = db.prepare(`
      SELECT key_id
      FROM institution_public_keys
      WHERE institution_id = ?
      LIMIT 1
    `).get(institutionId);

    if (existing) {
      throw new Error(
        "Institusi sudah memiliki riwayat kunci."
      );
    }

    const keyId = randomUUID();

    db.prepare(`
      INSERT INTO institution_public_keys (
        key_id,
        institution_id,
        version,
        public_key_jwk,
        fingerprint,
        status
      )
      VALUES (?, ?, 1, ?, ?, 'active')
    `).run(
      keyId,
      institutionId,
      JSON.stringify(publicKeyJwk),
      fingerprint
    );

    return {
      keyId,
      institutionId,
      version: 1,
      fingerprint,
      status: "active"
    };
  });

  return register.immediate();
}
