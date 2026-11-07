import {
  randomBytes,
  createHash,
} from "node:crypto";

import { authenticateAdmin } from "../services/adminAuthService.js";
import { authenticateStaff } from "../services/staffAuthService.js";
import db from "../config/database.js";

const sessions = new Map();
const SESSION_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), item.slice(index + 1)];
      }),
  );
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie).nexusmed_session;
  if (!token) return null;

  const key = hashToken(token);
  const session = sessions.get(key);

  if (!session) return null;

  if (Date.now() >= session.expiresAt) {
    sessions.delete(key);
    return null;
  }

  if (!session.userId) {
    sessions.delete(key);
    return null;
  }

  if (session.userId) {
    const user = db
      .prepare(
        `
      SELECT id, status, session_version, institution_id
      FROM users
      WHERE id = ?
    `,
      )
      .get(session.userId);

    let valid = Boolean(
      user &&
      user.status === "active" &&
      user.session_version === session.sessionVersion,
    );

    if (valid) {
      if (session.role === "consortium_admin") {
        const role = db
          .prepare(
            `
          SELECT 1
          FROM role_assignments
          WHERE user_id = ?
            AND role = 'consortium_admin'
            AND revoked_at IS NULL
        `,
          )
          .get(session.userId);

        valid = Boolean(role);
      } else if (session.role === "org1" || session.role === "org2") {
        const institution = db
          .prepare(
            `
          SELECT id, msp_id, status, can_send, can_receive
          FROM institutions
          WHERE id = ?
        `,
          )
          .get(user.institution_id);

        const permission =
          session.role === "org1" ? "referral_sender" : "referral_receiver";

        const role = db
          .prepare(
            `
          SELECT 1
          FROM role_assignments
          WHERE user_id = ?
            AND role = ?
            AND revoked_at IS NULL
        `,
          )
          .get(session.userId, permission);

        valid = Boolean(
          institution &&
          institution.status === "approved" &&
          institution.msp_id === session.institution &&
          session.institutionId === institution.id &&
          session.permission === permission &&
          role &&
          ((permission === "referral_sender" && institution.can_send === 1) ||
            (permission === "referral_receiver" &&
              institution.can_receive === 1)),
        );
      } else {
        valid = false;
      }
    }

    if (!valid) {
      sessions.delete(key);
      return null;
    }
  }

  return session;
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api",
  maxAge: SESSION_MS,
};

export function login(req, res) {
  const { username, password } = req.body ?? {};

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(401).json({
      error: "Username atau password salah.",
    });
  }

  let user = null;

  if (username === "nexusadmin") {
    const admin = authenticateAdmin(username, password);

    if (admin) {
      user = {
        userId: admin.id,
        username: admin.username,
        role: admin.role,
        institution: null,
        sessionVersion: admin.sessionVersion,
      };
    }
  } else {
    const staff = authenticateStaff(username, password);

    if (staff) {
      user = {
        userId: staff.id,
        username: staff.username,
        role: staff.role,
        institution: staff.institution,
        institutionId: staff.institutionId,
        permission: staff.permission,
        sessionVersion: staff.sessionVersion,
      };
    }
  }

  if (!user) {
    return res.status(401).json({
      error: "Username atau password salah.",
    });
  }

  const token = randomBytes(32).toString("hex");

  sessions.set(hashToken(token), {
    ...user,
    expiresAt: Date.now() + SESSION_MS,
  });

  res.cookie("nexusmed_session", token, cookieOptions);

  return res.json({
    status: "authenticated",
    user: {
      userId: user.userId ?? null,
      username: user.username,
      role: user.role,
      institution: user.institution,
      institutionId: user.institutionId ?? null,
    },
  });
}

export function requireAuth(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      error: "Login diperlukan.",
    });
  }

  req.user = session;
  next();
}

export function requireRole(role) {
  return [
    requireAuth,
    (req, res, next) => {
      if (req.user.role !== role) {
        return res.status(403).json({
          error: "Akses ditolak untuk role ini.",
        });
      }

      next();
    },
  ];
}

export function me(req, res) {
  const { userId, username, role, institution, institutionId } = req.user;

  res.json({
    user: {
      userId: userId ?? null,
      username,
      role,
      institution,
      institutionId: institutionId ?? null,
    },
  });
}

export function logout(req, res) {
  const token = parseCookies(req.headers.cookie).nexusmed_session;

  if (token) sessions.delete(hashToken(token));

  res.clearCookie("nexusmed_session", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieOptions.secure,
    path: "/api",
  });

  res.json({ status: "logged_out" });
}
