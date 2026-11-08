import Database from "better-sqlite3";
import { resolve } from "node:path";

const databasePath = process.argv[2];

if (!databasePath) {
  console.error(
    "Usage: node scripts/migrate-department-rbac.mjs <database-copy.db>"
  );
  process.exit(1);
}

const db = new Database(resolve(databasePath), {
  fileMustExist: true,
});

try {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        institution_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (institution_id)
          REFERENCES institutions(id),
        UNIQUE (institution_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_departments_institution
      ON departments(institution_id, status);

      CREATE TABLE IF NOT EXISTS user_department_assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        department_id TEXT NOT NULL,
        assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at TEXT,
        FOREIGN KEY (user_id)
          REFERENCES users(id),
        FOREIGN KEY (department_id)
          REFERENCES departments(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_user_department
      ON user_department_assignments(user_id, department_id)
      WHERE revoked_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_department_members
      ON user_department_assignments(department_id, revoked_at);

      CREATE TRIGGER IF NOT EXISTS trg_department_assignment_institution
      BEFORE INSERT ON user_department_assignments
      BEGIN
        SELECT CASE
          WHEN NOT EXISTS (
            SELECT 1
            FROM users u
            JOIN departments d
              ON d.id = NEW.department_id
            WHERE u.id = NEW.user_id
              AND u.institution_id = d.institution_id
          )
          THEN RAISE(
            ABORT,
            'User and department institution mismatch'
          )
        END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_department_assignment_update
      BEFORE UPDATE OF user_id, department_id
      ON user_department_assignments
      BEGIN
        SELECT CASE
          WHEN NOT EXISTS (
            SELECT 1
            FROM users u
            JOIN departments d
              ON d.id = NEW.department_id
            WHERE u.id = NEW.user_id
              AND u.institution_id = d.institution_id
          )
          THEN RAISE(
            ABORT,
            'User and department institution mismatch'
          )
        END;
      END;
    `);
  });

  migrate();

  const tables = [
    "departments",
    "user_department_assignments",
  ];

  for (const name of tables) {
    const row = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(name);

    if (!row) throw new Error(`Missing table: ${name}`);

    console.log(`PASS: ${name}`);
  }

  const integrity = db.pragma("integrity_check", {
    simple: true,
  });

  if (integrity !== "ok") {
    throw new Error(`Integrity check failed: ${integrity}`);
  }

  console.log("PASS: SQLite integrity");
  console.log("PASS: Department RBAC schema migration");
} finally {
  db.close();
}
