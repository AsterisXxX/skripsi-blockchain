import express from "express";
import cors from "cors";
import "dotenv/config";

import referralRoutes from "./routes/referralRoutes.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
  }),
);

app.use(express.json({ limit: "10mb" }));

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
