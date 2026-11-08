import { Router } from "express";
import {
  createHash,
  createECDH,
  randomBytes,
  randomUUID,
  hkdfSync,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import db from "../config/database.js";
import {
  isKeyRegistrationEnabled,
} from "../services/keyRegistrationPolicy.js";
import { registerFirstPublicKey } from "../services/keyRegistryService.js";
import { assertKeyRegistrySchema } from "../services/keyRegistrySchema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

assertKeyRegistrySchema(db);

const router = Router();

const CHALLENGE_TTL = 120000;
const MAX_CHALLENGES = 1000;
const challenges = new Map();

const RATE_WINDOW_MS = 60_000;
const SESSION_LIMIT = 10;
const INSTITUTION_LIMIT = 30;
const challengeRates = new Map();

function checkChallengeRate(sessionId, institutionId) {
  const now = Date.now();

  for (const [key, record] of challengeRates) {
    if (now >= record.resetAt) {
      challengeRates.delete(key);
    }
  }

  const limits = [
    { key: `session:${sessionId}`, limit: SESSION_LIMIT },
    { key: `institution:${institutionId}`, limit: INSTITUTION_LIMIT }
  ];

  for (const { key, limit } of limits) {
    const record = challengeRates.get(key);

    if (record && record.count >= limit) {
      return {
        allowed: false,
        retryAfter: Math.max(
          1,
          Math.ceil((record.resetAt - now) / 1000)
        )
      };
    }
  }

  for (const { key } of limits) {
    const record = challengeRates.get(key);

    if (record) {
      record.count++;
    } else {
      challengeRates.set(key, {
        count: 1,
        resetAt: now + RATE_WINDOW_MS
      });
    }
  }

  return { allowed: true };
}


function validatePublicKey(jwk) {
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk)) {
    throw new Error("Public key JWK tidak valid.");
  }

  if (
    Object.keys(jwk).some(
      key => !["kty", "crv", "x", "y"].includes(key)
    ) ||
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256"
  ) {
    throw new Error("Hanya public key EC P-256 yang didukung.");
  }

  const decode = value => {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value)
    ) {
      throw new Error("Koordinat public key tidak valid.");
    }

    const bytes = Buffer.from(value, "base64url");

    if (
      bytes.length !== 32 ||
      bytes.toString("base64url") !== value
    ) {
      throw new Error("Encoding koordinat tidak valid.");
    }

    return bytes;
  };

  const x = decode(jwk.x);
  const y = decode(jwk.y);

  const point = Buffer.concat([
    Buffer.from([4]),
    x,
    y
  ]);

  try {
    const validator = createECDH("prime256v1");
    validator.generateKeys();
    validator.computeSecret(point);
  } catch {
    throw new Error("Public key bukan titik P-256 valid.");
  }

  const fingerprint = createHash("sha256")
    .update(point)
    .digest("hex");

  return {
    point,
    fingerprint,
    publicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: x.toString("base64url"),
      y: y.toString("base64url")
    }
  };
}

function sessionFingerprint(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith("nexusmed_session="));

  if (!cookie) {
    throw new Error("Session cookie tidak ditemukan.");
  }

  return createHash("sha256")
    .update(cookie.slice("nexusmed_session=".length))
    .digest("hex");
}

function cleanupChallenges() {
  const now = Date.now();

  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now) {
      challenges.delete(id);
    }
  }
}

router.post("/challenge", requireRole("org2"), (req, res) => {
  try {
    cleanupChallenges();

    const institutionId = req.user.institutionId;

    if (!institutionId) {
      return res.status(403).json({
        error: "Identitas institusi tidak tersedia."
      });
    }

    const { point, fingerprint, publicKeyJwk } = validatePublicKey(
      req.body?.publicKeyJwk
    );

    const existing = db.prepare(`
      SELECT key_id
      FROM institution_public_keys
      WHERE institution_id = ?
      LIMIT 1
    `).get(institutionId);

    if (existing) {
      return res.status(409).json({
        error: "Riwayat kunci sudah ada. Gunakan prosedur rotasi."
      });
    }

    const sessionId = sessionFingerprint(req);

    const rate = checkChallengeRate(sessionId, institutionId);

    if (!rate.allowed) {
      res.set("Retry-After", String(rate.retryAfter));

      return res.status(429).json({
        error: "Terlalu banyak permintaan challenge.",
        retryAfter: rate.retryAfter
      });
    }

    for (const [id, challenge] of challenges) {
      if (challenge.sessionId === sessionId) {
        challenges.delete(id);
      }
    }

    if (challenges.size >= MAX_CHALLENGES) {
      return res.status(429).json({
        error: "Kapasitas challenge sementara penuh."
      });
    }

    const server = createECDH("prime256v1");
    server.generateKeys();

    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + CHALLENGE_TTL;

    challenges.set(challengeId, {
      challengeId,
      institutionId,
      sessionId,
      fingerprint,
      publicKeyJwk,
      nonce,
      sharedSecret: server.computeSecret(point),
      expiresAt
    });

    return res.status(201).json({
      protocol: "NexusMed-KeyPoP-v1",
      challengeId,
      institutionId,
      nonce,
      fingerprint,
      serverPublicKey: server.getPublicKey().toString("base64url"),
      expiresAt: new Date(expiresAt).toISOString()
    });
  } catch (error) {
    if (
      error.message?.includes("key") ||
      error.message?.includes("Koordinat") ||
      error.message?.includes("Encoding") ||
      error.message?.includes("P-256")
    ) {
      return res.status(400).json({
        error: error.message
      });
    }

    console.error("PoP challenge:", error.message);

    return res.status(500).json({
      error: "Gagal membuat challenge."
    });
  }
});

router.post("/challenge/verify", requireRole("org2"), (req, res) => {
  const { challengeId, proof } = req.body ?? {};

  if (
    typeof challengeId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(challengeId)
  ) {
    return res.status(400).json({
      error: "Challenge ID tidak valid."
    });
  }

  const challenge = challenges.get(challengeId);

  if (!challenge) {
    return res.status(404).json({
      error: "Challenge tidak ditemukan atau sudah digunakan."
    });
  }

  if (Date.now() >= challenge.expiresAt) {
    challenges.delete(challengeId);
    return res.status(410).json({
      error: "Challenge sudah kedaluwarsa."
    });
  }

  let sessionId;

  try {
    sessionId = sessionFingerprint(req);
  } catch {
    return res.status(401).json({
      error: "Session tidak valid."
    });
  }

  if (
    challenge.sessionId !== sessionId ||
    challenge.institutionId !== req.user.institutionId
  ) {
    return res.status(403).json({
      error: "Challenge tidak sesuai dengan sesi atau institusi."
    });
  }

  challenges.delete(challengeId);

  if (
    typeof proof !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(proof)
  ) {
    return res.status(400).json({
      error: "Format proof tidak valid."
    });
  }

  const received = Buffer.from(proof, "base64url");

  if (
    received.length !== 32 ||
    received.toString("base64url") !== proof
  ) {
    return res.status(400).json({
      error: "Encoding proof tidak valid."
    });
  }

  const context = {
    protocol: "NexusMed-KeyPoP-v1",
    challengeId: challenge.challengeId,
    institutionId: challenge.institutionId,
    nonce: challenge.nonce,
    fingerprint: challenge.fingerprint
  };

  const message = Buffer.from(JSON.stringify(context));

  const hmacKey = Buffer.from(
    hkdfSync(
      "sha256",
      challenge.sharedSecret,
      Buffer.from(challenge.nonce),
      Buffer.from("NexusMed-KeyPoP-v1"),
      32
    )
  );

  const expected = createHmac("sha256", hmacKey)
    .update(message)
    .digest();

  if (!timingSafeEqual(received, expected)) {
    return res.status(403).json({
      error: "Proof of Possession tidak valid."
    });
  }

  const registrationEnabled =
    isKeyRegistrationEnabled();

  if (!registrationEnabled) {
    return res.status(200).json({
      status: "proof_verified",
      challengeId,
      institutionId: challenge.institutionId,
      fingerprint: challenge.fingerprint,
      registrationEnabled: false
    });
  }

  try {
    const registered = registerFirstPublicKey(db, {
      institutionId: challenge.institutionId,
      publicKeyJwk: challenge.publicKeyJwk,
      fingerprint: challenge.fingerprint
    });

    return res.status(201).json({
      status: "key_registered",
      key: registered
    });
  } catch (error) {
    if (
      error.message === "Institusi tidak berwenang." ||
      error.message === "Institusi sudah memiliki riwayat kunci."
    ) {
      return res.status(409).json({
        error: "Registrasi kunci tidak diizinkan atau sudah ada."
      });
    }

    console.error("PoP key registration:", error.message);

    return res.status(500).json({
      error: "Registrasi public key gagal."
    });
  }
});

router.post("/register", requireRole("org2"), (req, res) => {
  return res.status(503).json({
    error: "Registrasi menunggu verifikasi Proof of Possession."
  });
});

router.get("/institutions/:id/active", requireAuth, (req, res) => {
  const institutionId = req.params.id;

  if (!/^[A-Za-z0-9_-]{1,80}$/.test(institutionId)) {
    return res.status(400).json({
      error: "Institution ID tidak valid."
    });
  }

  if (!["org1", "org2"].includes(req.user.role)) {
    return res.status(403).json({
      error: "Akses ditolak."
    });
  }

  const key = db.prepare(`
    SELECT k.key_id, k.institution_id, k.version,
           k.public_key_jwk, k.fingerprint
    FROM institution_public_keys k
    JOIN institutions i ON i.id = k.institution_id
    WHERE k.institution_id = ?
      AND k.status = 'active'
      AND i.status = 'approved'
      AND i.can_receive = 1
  `).get(institutionId);

  if (!key) {
    return res.status(404).json({
      error: "Public key aktif tidak ditemukan."
    });
  }

  return res.json({
    keyId: key.key_id,
    institutionId: key.institution_id,
    version: key.version,
    fingerprint: key.fingerprint,
    publicKeyJwk: JSON.parse(key.public_key_jwk)
  });
});

export default router;
