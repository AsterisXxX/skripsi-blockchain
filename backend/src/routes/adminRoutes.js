import { Router } from "express";
import {
  getInstitutions,
  getUsers,
  getAuditLogs,
  createUser,
  suspendUser,
  reactivateUser,
  revokeUserRole,
  assignUserRole,
} from "../controllers/adminController.js";

import db from "../config/database.js";
import { requireRole } from "../middleware/auth.js";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";

const router = Router();

router.use(...requireRole("consortium_admin"));

router.get("/institutions", getInstitutions);
router.get("/users", getUsers);
router.get("/audit-logs", getAuditLogs);

router.post("/users", createUser);

router.patch("/users/:id/suspend", suspendUser);

router.patch("/users/:id/reactivate", reactivateUser);

router.patch("/users/:id/revoke-role", revokeUserRole);

router.patch("/users/:id/assign-role", assignUserRole);

export default router;
