import {
  canReceiveReferral,
} from "../services/referralAuthorizationService.js";

/**
 * Fail-closed authorization for stored referrals.
 *
 * Must run AFTER requireRole("org2") and BEFORE any
 * MinIO/Fabric retrieval.
 *
 * db is injected so the guard can be tested independently.
 */
export function createReferralAccessGuard(db) {
  const findReferral = db.prepare(`
    SELECT
      referral_id,
      sender_institution_id,
      receiver_institution_id,
      target_department_id,
      document_hash,
      status,
      fabric_transaction_id
    FROM referral_registry
    WHERE referral_id = ?
  `);

  return function referralAccessGuard(req, res, next) {
    try {
      const referralId = req.params?.id;

      if (
        typeof referralId !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(referralId)
      ) {
        return res.status(400).json({
          error: "Referral ID tidak valid.",
        });
      }

      const referral = findReferral.get(referralId);

      // Legacy referrals without an access registry must be
      // explicitly backfilled and verified before exposure.
      if (!referral) {
        return res.status(404).json({
          error: "Rujukan tidak tersedia untuk akses.",
        });
      }

      if (
        !req.user?.userId ||
        !canReceiveReferral(db, {
          userId: req.user.userId,
          receiverInstitutionId:
            referral.receiver_institution_id,
          targetDepartmentId:
            referral.target_department_id,
        })
      ) {
        return res.status(403).json({
          error: "Akses rujukan ditolak.",
        });
      }

      if (referral.status !== "committed") {
        return res.status(409).json({
          error: "Rujukan belum selesai dicatat di ledger.",
        });
      }

      // This is metadata authorization only.
      // MinIO payload and Fabric ledger must still be verified.
      req.referralMetadata = referral;

      return next();
    } catch (error) {
      console.error(
        "Referral authorization failed:",
        error.message,
      );

      return res.status(503).json({
        error: "Otorisasi rujukan tidak tersedia.",
      });
    }
  };
}
