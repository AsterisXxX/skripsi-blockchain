import express from "express";
import cors from "cors";
import "dotenv/config";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

import referralRoutes from "./routes/referralRoutes.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;

  if (origin !== "http://localhost:5173") {
    return res.status(403).json({
      error: "Origin tidak diizinkan.",
    });
  }

  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    status: "success",
    message: "Blockchain Referral API is running",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", referralRoutes);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
