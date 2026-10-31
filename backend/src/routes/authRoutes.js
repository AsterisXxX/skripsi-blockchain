import { Router } from "express";
import { login, logout, me, requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/login", login);
router.get("/me", requireAuth, me);
router.post("/logout", requireAuth, logout);

export default router;
