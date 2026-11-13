import express from "express";
import cors from "cors";
import {
  allowedOrigins,
  requireAllowedOrigin,
} from "./middleware/originPolicy.js";
import "dotenv/config";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import keyRoutes from "./routes/keyRoutes.js";

import referralRoutes from "./routes/referralRoutes.js";

const app = express();
const PORT = process.env.PORT || 3001;



app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));

app.use(requireAllowedOrigin);

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/keys", keyRoutes);

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
