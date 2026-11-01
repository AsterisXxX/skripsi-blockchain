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
  const actual = scryptSync(password, salt, 64);

  return timingSafeEqual(actual, expected);
}

export function authenticateStaff(username, password) {
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 100 ||
    password.length > 1024
  ) {
    return null;
  }

  const user = db
    .prepare(
      `
    SELECT
      u.id,
      u.username,
      u.password_hash,
      u.session_version,
      u.institution_id,
      i.msp_id,
      r.role
    FROM users u
    JOIN institutions i
      ON i.id = u.institution_id
    JOIN role_assignments r
      ON r.user_id = u.id
      AND r.revoked_at IS NULL
    WHERE u.username = ?
      AND u.status = 'active'
      AND i.status = 'approved'
      AND (
        (r.role = 'referral_sender' AND i.can_send = 1)
        OR
        (r.role = 'referral_receiver' AND i.can_receive = 1)
      )
    LIMIT 1
  `,
    )
    .get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role === "referral_sender" ? "org1" : "org2",
    permission: user.role,
    institution: user.msp_id,
    institutionId: user.institution_id,
    sessionVersion: user.session_version,
  };
}
