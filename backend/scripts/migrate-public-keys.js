import db from "../src/config/database.js";
import { migratePublicKeyRegistry } from "../src/services/publicKeyMigration.js";

try {
  migratePublicKeyRegistry(db);
  console.log("Public key registry migration completed.");
  console.log(
    "Database integrity:",
    db.pragma("integrity_check", { simple: true })
  );
} finally {
  db.close();
}
