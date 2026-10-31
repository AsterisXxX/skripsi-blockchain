import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

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

  return session;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== "string" || !storedHash) return false;

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

const accounts = {
  org1: {
    role: "org1",
    institution: "Org1MSP",
    passwordHash: process.env.AUTH_ORG1_HASH,
  },
  org2: {
    role: "org2",
    institution: "Org2MSP",
    passwordHash: process.env.AUTH_ORG2_HASH,
  },
};

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api",
  maxAge: SESSION_MS,
};

export function login(req, res) {
  const { username, password } = req.body ?? {};

  const account = accounts[username];

  if (!account || !verifyPassword(password, account.passwordHash)) {
    return res.status(401).json({
      error: "Username atau password salah.",
    });
  }

  const token = randomBytes(32).toString("hex");

  sessions.set(hashToken(token), {
    username,
    role: account.role,
    institution: account.institution,
    expiresAt: Date.now() + SESSION_MS,
  });

  res.cookie("nexusmed_session", token, cookieOptions);

  return res.json({
    status: "authenticated",
    user: {
      username,
      role: account.role,
      institution: account.institution,
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
  const { username, role, institution } = req.user;

  res.json({
    user: { username, role, institution },
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
