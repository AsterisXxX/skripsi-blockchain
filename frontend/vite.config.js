import process from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "NEXUSMED_");

  return {
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: env.NEXUSMED_DEV_API_TARGET || "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
  };
});
