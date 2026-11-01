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

router.patch("/users/:id/suspend", (req, res) => {
  const userId = req.params.id;

  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return res.status(400).json({
      error: "User ID tidak valid.",
    });
  }

  const user = db
    .prepare(
      `
    SELECT id, username, status, institution_id
    FROM users
    WHERE id = ?
  `,
    )
    .get(userId);

  if (!user) {
    return res.status(404).json({
      error: "Pengguna tidak ditemukan.",
    });
  }

  if (user.id === req.user.userId || user.institution_id === null) {
    return res.status(403).json({
      error: "Akun administrator tidak dapat disuspend melalui endpoint ini.",
    });
  }

  if (user.status !== "active") {
    return res.status(409).json({
      error: "Hanya akun aktif yang dapat disuspend.",
    });
  }

  try {
    const suspendUser = db.transaction(() => {
      const result = db
        .prepare(
          `
        UPDATE users
        SET
          status = 'suspended',
          session_version = session_version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'active'
      `,
        )
        .run(userId);

      if (result.changes !== 1) {
        throw new Error("USER_STATE_CHANGED");
      }

      db.prepare(
        `
        INSERT INTO audit_logs (
          id,
          actor_user_id,
          action,
          target_type,
          target_id,
          details,
          result
        )
        VALUES (?, ?, 'SUSPEND_USER', 'user', ?, ?, 'success')
      `,
      ).run(
        randomUUID(),
        req.user.userId,
        userId,
        JSON.stringify({
          username: user.username,
          previousStatus: "active",
          newStatus: "suspended",
        }),
      );
    });

    suspendUser();

    return res.json({
      status: "success",
      message: "Pengguna berhasil disuspend.",
      user: {
        id: user.id,
        username: user.username,
        status: "suspended",
      },
    });
  } catch {
    return res.status(500).json({
      error: "Gagal menonaktifkan pengguna.",
    });
  }
});

router.patch("/users/:id/reactivate", (req, res) => {
  const userId = req.params.id;

  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    return res.status(400).json({
      error: "User ID tidak valid.",
    });
  }

  const user = db
    .prepare(
      `
    SELECT u.id, u.username, u.status, u.institution_id,
           i.status AS institution_status
    FROM users u
    LEFT JOIN institutions i ON i.id = u.institution_id
    WHERE u.id = ?
  `,
    )
    .get(userId);

  if (!user) {
    return res.status(404).json({
      error: "Pengguna tidak ditemukan.",
    });
  }

  if (!user.institution_id || user.status !== "suspended") {
    return res.status(409).json({
      error: "Hanya akun staf suspended yang dapat diaktifkan kembali.",
    });
  }

  if (user.institution_status !== "approved") {
    return res.status(403).json({
      error: "Institusi belum disetujui.",
    });
  }

  try {
    const reactivateUser = db.transaction(() => {
      const result = db
        .prepare(
          `
        UPDATE users
        SET status = 'active',
            session_version = session_version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'suspended'
      `,
        )
        .run(userId);

      if (result.changes !== 1) {
        throw new Error("USER_STATE_CHANGED");
      }

      db.prepare(
        `
        INSERT INTO audit_logs (
          id, actor_user_id, action,
          target_type, target_id, details, result
        )
        VALUES (?, ?, 'REACTIVATE_USER', 'user', ?, ?, 'success')
      `,
      ).run(
        randomUUID(),
        req.user.userId,
        userId,
        JSON.stringify({
          username: user.username,
          previousStatus: "suspended",
          newStatus: "active",
        }),
      );
    });

    reactivateUser();

    return res.json({
      status: "success",
      user: {
        id: user.id,
        username: user.username,
        status: "active",
      },
    });
  } catch {
    return res.status(500).json({
      error: "Gagal mengaktifkan pengguna.",
    });
  }
});

router.patch("/users/:id/revoke-role", (req, res) => {
  const userId = req.params.id;

  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    return res.status(400).json({
      error: "User ID tidak valid.",
    });
  }

  const user = db
    .prepare(
      `
    SELECT
      u.id,
      u.username,
      u.status,
      u.institution_id,
      r.id AS role_assignment_id,
      r.role
    FROM users u
    LEFT JOIN role_assignments r
      ON r.user_id = u.id
      AND r.revoked_at IS NULL
      AND r.role IN ('referral_sender', 'referral_receiver')
    WHERE u.id = ?
  `,
    )
    .get(userId);

  if (!user) {
    return res.status(404).json({
      error: "Pengguna tidak ditemukan.",
    });
  }

  if (!["org1", "org2"].includes(user.institution_id)) {
    return res.status(403).json({
      error: "Role administrator tidak dapat dicabut melalui endpoint ini.",
    });
  }

  if (!user.role_assignment_id) {
    return res.status(409).json({
      error: "Pengguna tidak memiliki role staf aktif.",
    });
  }

  const expectedRole =
    user.institution_id === "org1" ? "referral_sender" : "referral_receiver";

  if (user.role !== expectedRole) {
    return res.status(409).json({
      error: "Role tidak sesuai dengan institusi.",
    });
  }

  try {
    const revokeRole = db.transaction(() => {
      const result = db
        .prepare(
          `
        UPDATE role_assignments
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND user_id = ?
          AND revoked_at IS NULL
      `,
        )
        .run(user.role_assignment_id, userId);

      if (result.changes !== 1) {
        throw new Error("ROLE_STATE_CHANGED");
      }

      const updated = db
        .prepare(
          `
        UPDATE users
        SET
          session_version = session_version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND institution_id = ?
      `,
        )
        .run(userId, user.institution_id);

      if (updated.changes !== 1) {
        throw new Error("USER_STATE_CHANGED");
      }

      db.prepare(
        `
        INSERT INTO audit_logs (
          id,
          actor_user_id,
          action,
          target_type,
          target_id,
          details,
          result
        )
        VALUES (?, ?, 'REVOKE_ROLE', 'user', ?, ?, 'success')
      `,
      ).run(
        randomUUID(),
        req.user.userId,
        userId,
        JSON.stringify({
          username: user.username,
          institutionId: user.institution_id,
          role: user.role,
          previousState: "active",
          newState: "revoked",
        }),
      );
    });

    revokeRole();

    return res.json({
      status: "success",
      message: "Role pengguna berhasil dicabut.",
      user: {
        id: user.id,
        username: user.username,
        accountStatus: user.status,
        revokedRole: user.role,
      },
    });
  } catch {
    return res.status(500).json({
      error: "Gagal mencabut role pengguna.",
    });
  }
});

router.patch("/users/:id/assign-role", (req, res) => {
  const userId = req.params.id;

  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    return res.status(400).json({
      error: "User ID tidak valid.",
    });
  }

  const user = db
    .prepare(
      `
    SELECT id, username, status, institution_id
    FROM users
    WHERE id = ?
  `,
    )
    .get(userId);

  if (!user) {
    return res.status(404).json({
      error: "Pengguna tidak ditemukan.",
    });
  }

  if (!["org1", "org2"].includes(user.institution_id)) {
    return res.status(403).json({
      error: "Akun ini bukan akun staf yang didukung.",
    });
  }

  if (user.status !== "active") {
    return res.status(409).json({
      error: "Hanya akun aktif yang dapat diberikan role.",
    });
  }

  const role =
    user.institution_id === "org1" ? "referral_sender" : "referral_receiver";

  const institution = db
    .prepare(
      `
    SELECT id, status, can_send, can_receive
    FROM institutions
    WHERE id = ?
  `,
    )
    .get(user.institution_id);

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

  const activeRoles = db
    .prepare(
      `
    SELECT role
    FROM role_assignments
    WHERE user_id = ?
      AND revoked_at IS NULL
  `,
    )
    .all(userId);

  if (activeRoles.length > 0) {
    return res.status(409).json({
      error: "Pengguna masih memiliki role aktif.",
    });
  }

  try {
    const assignRole = db.transaction(() => {
      const currentUser = db
        .prepare(
          `
        SELECT status, session_version, institution_id
        FROM users
        WHERE id = ?
      `,
        )
        .get(userId);

      const currentInstitution = db
        .prepare(
          `
        SELECT status, can_send, can_receive
        FROM institutions
        WHERE id = ?
      `,
        )
        .get(user.institution_id);

      const existingRole = db
        .prepare(
          `
        SELECT 1
        FROM role_assignments
        WHERE user_id = ?
          AND revoked_at IS NULL
      `,
        )
        .get(userId);

      if (
        !currentUser ||
        currentUser.status !== "active" ||
        currentUser.institution_id !== user.institution_id ||
        !currentInstitution ||
        currentInstitution.status !== "approved" ||
        (role === "referral_sender" && currentInstitution.can_send !== 1) ||
        (role === "referral_receiver" &&
          currentInstitution.can_receive !== 1) ||
        existingRole
      ) {
        throw new Error("USER_OR_PERMISSION_STATE_CHANGED");
      }

      db.prepare(
        `
        INSERT INTO role_assignments (
          id, user_id, role, assigned_by
        )
        VALUES (?, ?, ?, ?)
      `,
      ).run(randomUUID(), userId, role, req.user.userId);

      const updated = db
        .prepare(
          `
        UPDATE users
        SET
          session_version = session_version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'active'
          AND session_version = ?
      `,
        )
        .run(userId, currentUser.session_version);

      if (updated.changes !== 1) {
        throw new Error("USER_STATE_CHANGED");
      }

      db.prepare(
        `
        INSERT INTO audit_logs (
          id,
          actor_user_id,
          action,
          target_type,
          target_id,
          details,
          result
        )
        VALUES (?, ?, 'ASSIGN_ROLE', 'user', ?, ?, 'success')
      `,
      ).run(
        randomUUID(),
        req.user.userId,
        userId,
        JSON.stringify({
          username: user.username,
          institutionId: user.institution_id,
          role,
          previousState: "revoked_or_unassigned",
          newState: "active",
        }),
      );
    });

    assignRole();

    return res.json({
      status: "success",
      message: "Role pengguna berhasil diberikan.",
      user: {
        id: user.id,
        username: user.username,
        accountStatus: "active",
        assignedRole: role,
      },
    });
  } catch (error) {
    if (
      error.message === "USER_OR_PERMISSION_STATE_CHANGED" ||
      error.message === "USER_STATE_CHANGED" ||
      error.code?.startsWith("SQLITE_CONSTRAINT")
    ) {
      return res.status(409).json({
        error: "Status pengguna atau izin telah berubah.",
      });
    }

    return res.status(500).json({
      error: "Gagal memberikan role pengguna.",
    });
  }
});

export default router;
