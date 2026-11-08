/**
 * NexusMed Referral Registry
 *
 * Application access index only.
 * Fabric remains authoritative for ledger integrity.
 * No clinical plaintext is stored here.
 */

const validId = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{1,80}$/.test(value);

const validHash = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value);

export function createReferralIntent(db, input) {
  const {
    referralId,
    senderInstitutionId,
    receiverInstitutionId,
    targetDepartmentId,
    documentHash,
  } = input;

  if (
    !validId(referralId) ||
    !validId(senderInstitutionId) ||
    !validId(receiverInstitutionId) ||
    !validId(targetDepartmentId) ||
    !validHash(documentHash)
  ) {
    throw new Error("INVALID_REFERRAL_METADATA");
  }

  if (senderInstitutionId === receiverInstitutionId) {
    throw new Error("INTRA_INSTITUTION_NOT_SUPPORTED");
  }

  return db.transaction(() => {
    const sender = db.prepare(`
      SELECT id FROM institutions
      WHERE id = ?
        AND status = 'approved'
        AND can_send = 1
    `).get(senderInstitutionId);

    if (!sender) {
      throw new Error("SENDER_NOT_AUTHORIZED");
    }

    const receiver = db.prepare(`
      SELECT i.id
      FROM institutions i
      JOIN departments d
        ON d.institution_id = i.id
      WHERE i.id = ?
        AND i.status = 'approved'
        AND i.can_receive = 1
        AND d.id = ?
        AND d.status = 'active'
    `).get(receiverInstitutionId, targetDepartmentId);

    if (!receiver) {
      throw new Error("INVALID_RECEIVER_DEPARTMENT");
    }

    const result = db.prepare(`
      INSERT INTO referral_registry (
        referral_id,
        sender_institution_id,
        receiver_institution_id,
        target_department_id,
        document_hash,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'pending_storage')
    `).run(
      referralId,
      senderInstitutionId,
      receiverInstitutionId,
      targetDepartmentId,
      documentHash,
    );

    if (result.changes !== 1) {
      throw new Error("REGISTRY_INSERT_FAILED");
    }

    return {
      referralId,
      senderInstitutionId,
      receiverInstitutionId,
      targetDepartmentId,
      documentHash,
      status: "pending_storage",
    };
  })();
}

export function markStorageCompleted(db, referralId) {
  const result = db.prepare(`
    UPDATE referral_registry
    SET status = 'pending_ledger',
        updated_at = CURRENT_TIMESTAMP
    WHERE referral_id = ?
      AND status = 'pending_storage'
  `).run(referralId);

  if (result.changes !== 1) {
    throw new Error("INVALID_STORAGE_TRANSITION");
  }
}

export function markLedgerCommitted(db, referralId, transactionId) {
  if (
    !validId(referralId) ||
    typeof transactionId !== "string" ||
    transactionId.length === 0
  ) {
    throw new Error("INVALID_COMMIT_METADATA");
  }

  const result = db.prepare(`
    UPDATE referral_registry
    SET status = 'committed',
        fabric_transaction_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE referral_id = ?
      AND status = 'pending_ledger'
  `).run(transactionId, referralId);

  if (result.changes !== 1) {
    throw new Error("INVALID_LEDGER_TRANSITION");
  }
}
