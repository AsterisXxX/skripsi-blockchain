// OFFLINE M15 ROUTE COPY - NOT PRODUCTION WIRED
import { Router } from "express";
import db from "../config/database.js";
import {
  decideFabricJournalPathV3,
} from "../services/fabricJournalDowngradeGuardV3.js";
import {
  executeFabricJournalGatewayV3,
} from "../services/fabricJournalGatewayAdapterV3.js";
import {
  createJournalGatewayV3,
} from "../services/fabricJournalGatewayFactoryV3.js";
import {
  createAdmittedRegistryIntentCandidateV3,
} from "../services/fabricRegistryAdmissionIntegrationCandidateV3.js";

import {
  executeHttpSubmissionBoundaryCandidateV3,
} from "../services/fabricHttpSubmissionBoundaryCandidateV3.js";

import {
  assertFabricSchemaIntegrityCandidateV3,
} from "../services/fabricSchemaIntegrityGuardCandidateV3.js";

import {
  createOfflineFabricContractCandidateV3,
} from "../services/fabricOfflineContractProviderCandidateV3.js";
import {
  storeReferralCiphertext,
} from "../services/referralStorageService.js";
import {
  createReferralAccessGuard,
} from "../middleware/referralAccess.js";

import {
  validateNewReferralPreflight,
} from "../services/referralWritePreflight.js";
import {
  calculateReferralDocumentHash,
  verifyReferralDocumentHash,
} from "../services/versionedReferralIntegrity.js";
import { minioClient, BUCKET, checkMinio } from "../config/minio.js";
import { requireRole } from "../middleware/auth.js";
import {
  getReferralFromFabric,
} from "../services/fabricService.js";

import {
  findAvailableReferralDepartments,
} from "../repositories/referralDepartmentRepository.js";

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

router.get(
  "/referral-departments",
  ...requireRole("org1"),
  (req, res) => {
    try {
      const departments = findAvailableReferralDepartments(db);

      return res.json({
        status: "success",
        departments,
      });
    } catch (error) {
      console.error("Department discovery failed:", error.message);
      return res.status(503).json({
        error: "Daftar poli tujuan tidak tersedia.",
      });
    }
  },
);

router.post("/referrals", requireRole("org1"), async (req, res) => {
  try {
    // M15_EARLY_SCHEMA_PREFLIGHT_V3
    // OFFLINE CANDIDATE ONLY.
    //
    // Verify required schema BEFORE any registry
    // insertion or external storage operation.
    //
    // This is a readiness check, not a complete
    // migration-integrity or constraint audit.
    try {
      assertFabricSchemaIntegrityCandidateV3(db);

      const requiredSchema = [
        {
          table: "referral_registry",
          columns: [
            "referral_id",
            "document_hash",
            "status",
          ],
        },
        {
          table:
            "fabric_submission_admission_candidate_v3",
          columns: [
            "referral_id",
            "document_hash",
          ],
        },
        {
          table:
            "fabric_submission_ownership_txid_candidate_v3",
          columns: [
            "referral_id",
            "transaction_id",
          ],
        },
        {
          table: "fabric_submission_journal_v3",
          columns: [
            "referral_id",
            "transaction_id",
          ],
        },
      ];

      for (const requirement of requiredSchema) {
        const table = db.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = ?
        `).get(requirement.table);

        if (!table) {
          throw new Error("M15_REQUIRED_TABLE_MISSING");
        }

        // These identifiers are static, not
        // derived from request data.
        const columns = db.prepare(
          `PRAGMA table_info("${requirement.table}")`
        ).all();

        const found = new Set(
          columns.map(column => column.name)
        );

        if (
          requirement.columns.some(
            column => !found.has(column)
          )
        ) {
          throw new Error("M15_REQUIRED_COLUMN_MISSING");
        }
      }
    } catch {
      console.error(
        "M15_SCHEMA_NOT_READY phase=preflight"
      );

      return res.status(503).json({
        status: "unavailable",
        reason: "M15_SCHEMA_NOT_READY",
        message:
          "Layanan rujukan belum siap. " +
          "Hubungi administrator sebelum mencoba kembali.",
      });
    }

    // M15: reject invalid journal configuration before
    // creating a registry intent or writing to MinIO.
    const journalMode =
      process.env.NEXUSMED_FABRIC_JOURNAL_MODE ?? "disabled";

    if (
      journalMode !== "disabled" &&
      journalMode !== "prepare_only"
    ) {
      console.error("FABRIC_JOURNAL_INVALID_CONFIGURATION");
      return res.status(503).json({
        error: "Konfigurasi journal Fabric tidak valid.",
      });
    }
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

    // Preserve the existing structural requirements for v1.
    // The version policy below controls whether v1 or v2
    // submissions are allowed.
    if (payload?.version === 1) {
      if (
        payload.algorithm !==
          "AES-256-GCM + ECDH-P256 + HKDF-SHA256" ||
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

      try {
        decodeBase64(payload.ciphertext);
      } catch (error) {
        return res.status(400).json({
          error: error.message,
        });
      }
    }

    let hash;

    try {
      const preflight = validateNewReferralPreflight({
        db,
        payload,
        receiverInstitutionId,
        env: process.env,
      });

      hash = preflight.documentHash;
    } catch (error) {
      if (error.message === "INVALID_REFERRAL_WRITE_MODE") {
        console.error("Referral write policy configuration invalid.");

        return res.status(503).json({
          error: "Kebijakan penerimaan rujukan tidak tersedia.",
        });
      }

      return res.status(400).json({
        error: "Encrypted payload gagal divalidasi.",
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
      createAdmittedRegistryIntentCandidateV3(db, {
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

    // M15 OFFLINE CANDIDATE ONLY.
    // Storage confirmation comes from the server.
    // Contract provider is closed unless test-mocked.
    let contract;

    try {
      contract = createOfflineFabricContractCandidateV3({
        referralId,
      });

      if (
        !contract ||
        typeof contract.createTransaction !== "function"
      ) {
        throw new Error("M15_CONTRACT_UNAVAILABLE");
      }
    } catch {
      // Storage already confirmed, but no Fabric
      // transaction may be attempted without a
      // verified contract provider.
      //
      // Do not log raw provider errors or change
      // the durable registry state.
      console.error(
        "FABRIC_CONTRACT_UNAVAILABLE phase=provider"
      );

      return res.status(202).json({
        status: "pending_review",
        referralId,
        objectKey: key,
        documentHash: hash,
        allowFabricRetry: false,
        allowRegistryCommit: false,
        message:
          "Ciphertext sudah tersimpan, tetapi layanan " +
          "Fabric belum tersedia. Diperlukan rekonsiliasi.",
      });
    }

    const submission =
      await executeHttpSubmissionBoundaryCandidateV3({
        db,
        contract,
        referralId,
        patientId,
        receiverId: "Org2MSP",
        documentHash: hash,
        timestamp: document.storedAt,
        storageConfirmed: storageResult.ok === true,
      });

    // No automatic registry commit.
    return res.status(submission.code).json({
      ...submission.body,
      objectKey: key,
      documentHash: hash,
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

    // Read-only verification supports both historical v1
    // and canonical-envelope v2 integrity contracts.
    let calculatedHash;

    try {
      calculatedHash = calculateReferralDocumentHash(
        document.payload
      );
    } catch {
      return res.status(422).json({
        status: "invalid_document",
        error: "Format encrypted envelope tidak valid.",
      });
    }

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

    let envelopeVerified = false;

    try {
      envelopeVerified = verifyReferralDocumentHash(
        document.payload,
        req.referralMetadata.document_hash
      ).verified;
    } catch {
      // Fail closed without changing the HTTP response contract.
    }

    const isValid =
      ledger.referralId === id &&
      envelopeVerified &&
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
