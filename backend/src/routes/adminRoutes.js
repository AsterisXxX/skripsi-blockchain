import { Router } from "express";
import db from "../config/database.js";
import { requireRole } from "../middleware/auth.js";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";

const router = Router();

router.use(...requireRole("consortium_admin"));

router.get("/institutions", (req, res) => {
  try {
    const institutions = db
      .prepare(
        `
      SELECT
        id,
        name,
        msp_id,
        status,
        can_send,
        can_receive,
        created_at,
        updated_at
      FROM institutions
      ORDER BY id
    `,
      )
      .all();

    res.json({
      status: "success",
      total: institutions.length,
      institutions,
    });
  } catch {
    res.status(500).json({
      error: "Gagal mengambil data institusi.",
    });
  }
});

router.get("/users", (req, res) => {
  try {
    const users = db
      .prepare(
        `
      SELECT
        u.id,
        u.username,
        u.institution_id,
        u.status,
        u.created_at,
        GROUP_CONCAT(r.role, ', ') AS roles
      FROM users u
      LEFT JOIN role_assignments r
        ON r.user_id = u.id
        AND r.revoked_at IS NULL
      GROUP BY
        u.id,
        u.username,
        u.institution_id,
        u.status,
        u.created_at
      ORDER BY u.username
    `,
      )
      .all();

    res.json({
      status: "success",
      total: users.length,
      users,
    });
  } catch {
    res.status(500).json({
      error: "Gagal mengambil data pengguna.",
    });
  }
});

router.get("/audit-logs", (req, res) => {
  try {
    const logs = db
      .prepare(
        `
      SELECT
        a.id,
        a.action,
        a.target_type,
        a.target_id,
        a.details,
        a.result,
        a.created_at,
        u.username AS actor
      FROM audit_logs a
      LEFT JOIN users u
        ON a.actor_user_id = u.id
      ORDER BY a.created_at DESC, a.rowid DESC
      LIMIT 100
    `,
      )
      .all();

    res.json({
      status: "success",
      total: logs.length,
      logs: logs.map((log) => ({
        id: log.id,
        actor: log.actor || "system",
        action: log.action,
        targetType: log.target_type,
        targetId: log.target_id,
        result: log.result,
        createdAt: log.created_at,
      })),
    });
  } catch {
    res.status(500).json({
      error: "Gagal mengambil audit logs.",
    });
  }
});

router.post("/users", (req, res) => {
  const { username, password, institutionId, role } = req.body ?? {};

  if (
    typeof username !== "string" ||
    !/^[a-z][a-z0-9_]{3,31}$/.test(username) ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128 ||
    typeof institutionId !== "string" ||
    !["org1", "org2"].includes(institutionId)
  ) {
    return res.status(400).json({
      error: "Data pengguna tidak valid.",
    });
  }

  const expectedRole =
    institutionId === "org1" ? "referral_sender" : "referral_receiver";

  if (role !== expectedRole) {
    return res.status(400).json({
      error: "Role tidak sesuai izin institusi.",
    });
  }

  const institution = db
    .prepare(
      `
    SELECT id, status, can_send, can_receive
    FROM institutions
    WHERE id = ?
  `,
    )
    .get(institutionId);

  if (
    !institution ||
    institution.status !== "approved" ||
    (role === "referral_sender" && institution.can_send !== 1) ||
    (role === "referral_receiver" && institution.can_receive !== 1)
  ) {
    return res.status(403).json({
      error: "Institusi tidak memiliki izin untuk role ini.",
    });
  }

  const existing = db
    .prepare(
      `
    SELECT id FROM users WHERE username = ?
  `,
    )
    .get(username);

  if (existing || ["org1", "org2", "nexusadmin"].includes(username)) {
    return res.status(409).json({
      error: "Username sudah digunakan.",
    });
  }

  try {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    const userId = randomUUID();

    const createUser = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO users (
          id, username, password_hash, institution_id, status
        )
        VALUES (?, ?, ?, ?, 'active')
      `,
      ).run(userId, username, `${salt}:${hash}`, institutionId);

      db.prepare(
        `
        INSERT INTO role_assignments (
          id, user_id, role, assigned_by
        )
        VALUES (?, ?, ?, ?)
      `,
      ).run(randomUUID(), userId, role, req.user.userId);

      db.prepare(
        `
        INSERT INTO audit_logs (
          id, actor_user_id, action,
          target_type, target_id, details, result
        )
        VALUES (?, ?, 'CREATE_USER', 'user', ?, ?, 'success')
      `,
      ).run(
        randomUUID(),
        req.user.userId,
        userId,
        JSON.stringify({ username, institutionId, role }),
      );
    });

    createUser();

    return res.status(201).json({
      status: "created",
      user: {
        id: userId,
        username,
        institutionId,
        role,
        status: "active",
      },
    });
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({
        error: "Data pengguna sudah ada atau tidak valid.",
      });
    }

    return res.status(500).json({
      error: "Gagal membuat pengguna.",
    });
  }
});

export default router;
