import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  findAvailableReferralDepartments,
} from "../src/repositories/referralDepartmentRepository.js";

test("referral discovery returns only eligible Org2 departments", () => {
  const db = new Database(":memory:");

  try {
    db.exec(`
      CREATE TABLE institutions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        can_receive INTEGER NOT NULL
      );

      CREATE TABLE departments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        institution_id TEXT NOT NULL,
        status TEXT NOT NULL
      );

      INSERT INTO institutions VALUES
        ('org2', 'approved', 1),
        ('org3', 'approved', 1),
        ('org4', 'suspended', 1),
        ('org5', 'approved', 0);

      INSERT INTO departments VALUES
        ('poli_umum_org2', 'Poli Umum', 'org2', 'active'),
        ('poli_anak_org2', 'Poli Anak', 'org2', 'active'),
        ('poli_jantung_org2', 'Poli Jantung', 'org2', 'active'),
        ('poli_inactive_org2', 'Tidak Aktif', 'org2', 'inactive'),
        ('poli_umum_org3', 'Poli Umum Org3', 'org3', 'active'),
        ('poli_umum_org4', 'Poli Umum Org4', 'org4', 'active'),
        ('poli_umum_org5', 'Poli Umum Org5', 'org5', 'active');
    `);

    const result = findAvailableReferralDepartments(db);

    assert.deepEqual(
      result.map(item => item.id),
      [
        "poli_anak_org2",
        "poli_jantung_org2",
        "poli_umum_org2",
      ]
    );

    assert.deepEqual(
      Object.keys(result[0]).sort(),
      ["id", "institution_id", "name"]
    );

    assert.ok(
      result.every(item => item.institution_id === "org2")
    );

    db.prepare(`
      UPDATE institutions
      SET can_receive = 0
      WHERE id = 'org2'
    `).run();

    assert.deepEqual(
      findAvailableReferralDepartments(db),
      []
    );

    console.log("Department eligibility filtering: PASS");
    console.log("No staff membership dependency: PASS");

  } finally {
    db.close();
  }
});
