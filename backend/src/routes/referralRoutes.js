import { Router } from "express";
import db from "../config/database.js";
import {
  createReferralIntent,
  markLedgerCommitted,
} from "../services/referralRegistryService.js";
import {
  storeReferralCiphertext,
} from "../services/referralStorageService.js";
import {
  createReferralAccessGuard,
} from "../middleware/referralAccess.js";

import { createHash } from "node:crypto";
import { minioClient, BUCKET, checkMinio } from "../config/minio.js";
import { requireRole } from "../middleware/auth.js";
import {
  createReferralOnFabric,
  getReferralFromFabric,
} from "../services/fabricService.js";

const router = Router();

const validId = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(id);
const objectName = (id) => `referrals/${id}.json`;

function decodeBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Format ciphertext Base64 tidak valid.");
  }

  const bytes = Buffer.from(value, "base64");

  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw new Error("Ciphertext Base64 tidak valid.");
  }

  return bytes;
}

router.get("/storage/health", async (req, res) => {
  try {
    const exists = await checkMinio();

    res.status(exists ? 200 : 503).json({
      status: exists ? "connected" : "bucket_missing",
      bucket: BUCKET,
    });
  } catch (error) {
    console.error("Storage health:", error.message);
    res.status(503).json({
      status: "disconnected",
    });
  }
});

router.post("/referrals", requireRole("org1"), async (req, res) => {
  try {
    const {
      referralId,
      patientId,
      payload,
      targetDepartmentId,
    } = req.body;

    const senderInstitutionId = req.user?.institutionId;
    const receiverInstitutionId = "org2";

    // Legacy Org1 -> Org2 integration only.
    // The sender identity is derived from the server session.
    if (
      senderInstitutionId !== "org1" ||
      req.user?.institution !== "Org1MSP"
    ) {
      return res.status(403).json({
        error: "Institusi pengirim tidak diizinkan.",
      });
    }

    if (
      typeof targetDepartmentId !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(targetDepartmentId)
    ) {
      return res.status(400).json({
        error: "Poli tujuan harus dipilih dari daftar resmi.",
      });
    }

    if (!validId(referralId)) {
      return res.status(400).json({
        error: "Referral ID tidak valid.",
      });
    }

    if (
      typeof patientId !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(patientId)
    ) {
      return res.status(400).json({
        error: "Patient ID sintetis tidak valid.",
      });
    }

    if (
      !payload ||
      payload.version !== 1 ||
      payload.algorithm !== "AES-256-GCM + ECDH-P256 + HKDF-SHA256" ||
      !payload.ciphertext ||
      !payload.iv ||
      !payload.wrappedKey ||
      !payload.wrapIv ||
      !payload.salt ||
      !payload.ephemeralPublicKey
    ) {
      return res.status(400).json({
        error: "Encrypted payload tidak lengkap.",
      });
    }

    let ciphertext;

    try {
      ciphertext = decodeBase64(payload.ciphertext);
    } catch (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    const hash = createHash("sha256").update(ciphertext).digest("hex");

    if (
      typeof payload.documentHash !== "string" ||
      hash !== payload.documentHash
    ) {
      return res.status(400).json({
        error: "Hash ciphertext tidak sesuai.",
      });
    }

    const key = objectName(referralId);

    try {
      await minioClient.statObject(BUCKET, key);

      return res.status(409).json({
        error: "Referral ID sudah ada di storage.",
      });
    } catch (error) {
      if (error.code !== "NotFound" && error.code !== "NoSuchKey") {
        throw error;
      }
    }

    try {
      createReferralIntent(db, {
        referralId,
        senderInstitutionId,
        receiverInstitutionId,
        targetDepartmentId,
        documentHash: hash,
      });
    } catch (registryError) {
      if (
        registryError.code?.startsWith("SQLITE_CONSTRAINT") ||
        registryError.message === "INVALID_RECEIVER_DEPARTMENT"
      ) {
        return res.status(409).json({
          error:
            "ID rujukan sudah dipakai atau poli tujuan tidak valid.",
        });
      }

      if (
        registryError.message === "SENDER_NOT_AUTHORIZED" ||
        registryError.message === "INTRA_INSTITUTION_NOT_SUPPORTED"
      ) {
        return res.status(403).json({
          error: "Institusi tidak diizinkan membuat rujukan.",
        });
      }

      throw registryError;
    }

    const document = {
      referralId,
      payload,
      storedAt: new Date().toISOString(),
    };

    const buffer = Buffer.from(JSON.stringify(document));

    const storageResult = await storeReferralCiphertext({
      db,
      minioClient,
      bucket: BUCKET,
      objectKey: key,
      buffer,
      referralId,
    });

    if (!storageResult.ok) {
      return res.status(202).json({
        status: "pending_storage",
        referralId,
        objectKey: key,
        documentHash: hash,
        reason: storageResult.reason,
        message:
          "Status penyimpanan belum terkonfirmasi. " +
          "Jangan kirim ulang sebelum rekonsiliasi.",
      });
    }

    let ledger;

    try {
      ledger = await createReferralOnFabric({
        referralId,
        patientId,
        receiverId: "Org2MSP",
        documentHash: hash,
        timestamp: document.storedAt,
      });

      const committedRecord = await getReferralFromFabric(referralId);

      if (
        committedRecord.referralId !== referralId ||
        committedRecord.recordHash !== hash
      ) {
        throw new Error(
          "FABRIC_RECORD_MISMATCH: review reconciliation before retry"
        );
      }

      markLedgerCommitted(
        db,
        referralId,
        ledger.transactionId,
      );
    } catch (fabricError) {
      console.error("Commit Fabric belum terkonfirmasi:", fabricError);

      return res.status(202).json({
        status: "pending_ledger",
        referralId,
        objectKey: key,
        documentHash: hash,
        message:
          "Ciphertext tersimpan di MinIO, tetapi commit Fabric belum " +
          "terkonfirmasi. Jangan mengirim ulang sebelum rekonsiliasi.",
      });
    }

    return res.status(201).json({
      status: "stored_hybrid",
      referralId,
      objectKey: key,
      documentHash: hash,
      transactionId: ledger.transactionId,
      message: "Ciphertext tersimpan di MinIO dan hash tercatat di Fabric.",
    });
  } catch (error) {
    console.error("Upload MinIO:", error.message);
    res.status(500).json({
      error: "Gagal menyimpan ciphertext.",
    });
  }
});

router.get(
  "/referrals/:id/verified",
  requireRole("org2"),
  createReferralAccessGuard(db),
  async (req, res) => {
  const { id } = req.params;

  if (!validId(id)) {
    return res.status(400).json({
      status: "invalid_id",
      error: "Referral ID tidak valid.",
    });
  }

  try {
    const stream = await minioClient.getObject(BUCKET, objectName(id));

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const document = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    if (
      document.referralId !== id ||
      typeof document.payload?.ciphertext !== "string"
    ) {
      return res.status(422).json({
        status: "invalid_document",
        error: "Struktur dokumen MinIO tidak valid.",
      });
    }

    const ciphertext = decodeBase64(document.payload.ciphertext);

    const calculatedHash = createHash("sha256")
      .update(ciphertext)
      .digest("hex");

    let ledger;

    try {
      ledger = await getReferralFromFabric(id);
    } catch (error) {
      console.error("Fabric verification:", error.message);

      return res.status(503).json({
        status: "ledger_unavailable",
        error: "Hash referensi ledger tidak dapat diperoleh.",
      });
    }

    const ledgerHash = ledger.recordHash;
    const payloadHash = document.payload.documentHash;

    const isValid =
      ledger.referralId === id &&
      calculatedHash === ledgerHash &&
      calculatedHash === payloadHash &&
      calculatedHash === req.referralMetadata.document_hash;

    if (!isValid) {
      return res.status(409).json({
        status: "integrity_failed",
        referralId: id,
        calculatedHash,
        ledgerHash,
        payloadHash,
        verified: false,
      });
    }

    return res.status(200).json({
      status: "integrity_verified",
      referralId: id,
      calculatedHash,
      ledgerHash,
      verified: true,
      payload: document.payload,
    });
  } catch (error) {
    if (error.code === "NoSuchKey" || error.code === "NotFound") {
      return res.status(404).json({
        status: "not_found",
        error: "Rujukan tidak ditemukan di MinIO.",
      });
    }

    console.error("Hybrid verification:", error.message);

    return res.status(500).json({
      status: "verification_error",
      error: "Verifikasi integritas gagal diproses.",
    });
  }
  },
);

export default router;
