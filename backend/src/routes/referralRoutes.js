import { Router } from "express";
import { createHash } from "node:crypto";
import { minioClient, BUCKET, checkMinio } from "../config/minio.js";

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

router.post("/referrals", async (req, res) => {
  try {
    const { referralId, payload } = req.body;

    if (!validId(referralId)) {
      return res.status(400).json({
        error: "Referral ID tidak valid.",
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

    const document = {
      referralId,
      payload,
      storedAt: new Date().toISOString(),
    };

    const buffer = Buffer.from(JSON.stringify(document));

    await minioClient.putObject(BUCKET, key, buffer, buffer.length, {
      "Content-Type": "application/json",
    });

    res.status(201).json({
      status: "stored_offchain",
      referralId,
      objectKey: key,
      documentHash: hash,
      message: "Ciphertext tersimpan di MinIO.",
    });
  } catch (error) {
    console.error("Upload MinIO:", error.message);
    res.status(500).json({
      error: "Gagal menyimpan ciphertext.",
    });
  }
});

router.get("/referrals/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!validId(id)) {
      return res.status(400).json({
        error: "Referral ID tidak valid.",
      });
    }

    const stream = await minioClient.getObject(BUCKET, objectName(id));

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const document = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    res.json(document);
  } catch (error) {
    if (error.code === "NoSuchKey" || error.code === "NotFound") {
      return res.status(404).json({
        error: "Rujukan tidak ditemukan.",
      });
    }

    console.error("Download MinIO:", error.message);

    res.status(500).json({
      error: "Gagal mengambil ciphertext.",
    });
  }
});

export default router;
