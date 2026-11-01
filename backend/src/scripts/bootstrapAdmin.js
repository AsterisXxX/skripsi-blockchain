
import "dotenv/config";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import db from "../config/database.js";

const username = "nexusadmin";
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

try {
  if (!password || password.length < 12) {
    throw new Error("Password admin minimal 12 karakter.");
  }

  const existingAdmin = db.prepare(`
    SELECT u.username
    FROM users u
    JOIN role_assignments r ON r.user_id = u.id
    WHERE r.role = 'consortium_admin'
      AND r.revoked_at IS NULL
    LIMIT 1
  `).get();

  if (existingAdmin) {
    throw new Error(
      "Consortium Admin sudah tersedia. Bootstrap dibatalkan."
    );
  }

  const existingUsername = db.prepare(`
    SELECT id FROM users WHERE username = ?
  `).get(username);

  if (existingUsername) {
    throw new Error("Username nexusadmin sudah digunakan.");
  }

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const passwordHash = `${salt}:${hash}`;

  const userId = randomUUID();

  const createAdmin = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (
        id, username, password_hash, institution_id, status
      )
      VALUES (?, ?, ?, NULL, 'active')
    `).run(userId, username, passwordHash);

    db.prepare(`
      INSERT INTO role_assignments (
        id, user_id, role, assigned_by
      )
      VALUES (?, ?, 'consortium_admin', NULL)
    `).run(randomUUID(), userId);

    db.prepare(`
      INSERT INTO audit_logs (
        id, actor_user_id, action,
        target_type, target_id, details, result
      )
      VALUES (?, NULL, ?, ?, ?, ?, 'success')
    `).run(
      randomUUID(),
      "BOOTSTRAP_ADMIN",
      "user",
      userId,
      JSON.stringify({ username })
    );
  });

  createAdmin();

  console.log("=== ADMIN BOOTSTRAP ===");
  console.log("Status: SUCCESS");
  console.log("Username:", username);
  console.log("Role: consortium_admin");
  console.log("Password tersimpan sebagai salted scrypt hash.");
} catch (error) {
  console.error("Bootstrap dibatalkan:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
