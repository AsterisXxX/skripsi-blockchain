
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const databaseDir = join(homedir(), ".local", "share", "nexusmed");
mkdirSync(databaseDir, { recursive: true, mode: 0o700 });

const isTest = process.env.NODE_ENV === "test";

if (
  isTest &&
  process.env.NEXUSMED_TEST_DATABASE !== "isolated"
) {
  throw new Error(
    "Test mode memerlukan database terisolasi."
  );
}

const databasePath = isTest
  ? join(databaseDir, "test", "auth-test.db")
  : join(databaseDir, "auth.db");

if (isTest) {
  mkdirSync(join(databaseDir, "test"), {
    recursive: true,
    mode: 0o700
  });
}

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS institutions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    msp_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'suspended')),
    can_send INTEGER NOT NULL DEFAULT 0
      CHECK (can_send IN (0, 1)),
    can_receive INTEGER NOT NULL DEFAULT 0
      CHECK (can_receive IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    institution_id TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'suspended', 'disabled')),
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (institution_id) REFERENCES institutions(id)
  );

  CREATE TABLE IF NOT EXISTS role_assignments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL
      CHECK (role IN (
        'consortium_admin',
        'institution_admin',
        'referral_sender',
        'referral_receiver'
      )),
    assigned_by TEXT,
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (assigned_by) REFERENCES users(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_active_user_role
  ON role_assignments(user_id, role)
  WHERE revoked_at IS NULL;

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details TEXT,
    result TEXT NOT NULL
      CHECK (result IN ('success', 'failure')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created
  ON audit_logs(created_at);

  CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON audit_logs(actor_user_id);
`);

export default db;
export { databasePath };