
import { scryptSync, timingSafeEqual } from "node:crypto";
import db from "../config/database.js";

function verifyPassword(password, storedHash) {
  if (typeof password !== "string" || typeof storedHash !== "string") {
    return false;
  }

  const [salt, expectedHex] = storedHash.split(":");

  if (
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(expectedHex || "")
  ) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);

  return timingSafeEqual(actual, expected);
}

export function authenticateAdmin(username, password) {
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 100 ||
    password.length > 1024
  ) {
    return null;
  }

  const user = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.password_hash,
      u.status,
      u.session_version,
      r.role
    FROM users u
    JOIN role_assignments r ON r.user_id = u.id
    WHERE u.username = ?
      AND r.role = 'consortium_admin'
      AND r.revoked_at IS NULL
    LIMIT 1
  `).get(username);

  if (!user || user.status !== "active") {
    return null;
  }

  if (!verifyPassword(password, user.password_hash)) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    institution: null,
    sessionVersion: user.session_version,
  };
}
