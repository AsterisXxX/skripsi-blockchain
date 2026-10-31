import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];

if (!password || password.length < 12) {
  console.error("Gunakan password minimal 12 karakter.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");

console.log(`${salt}:${hash}`);
