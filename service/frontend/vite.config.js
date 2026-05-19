import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/auth": { target: "http://backend:8000", changeOrigin: true },
      "/entities": { target: "http://backend:8000", changeOrigin: true },
      "/users": { target: "http://backend:8000", changeOrigin: true },
      "/benchmarks": { target: "http://backend:8000", changeOrigin: true },
      "/spatial/range-query": { target: "http://backend:8000", changeOrigin: true },
      "/datasets": { target: "http://backend:8000", changeOrigin: true },
      "/files": { target: "http://backend:8000", changeOrigin: true },
      "/backup": { target: "http://backend:8000", changeOrigin: true },
      "/health": { target: "http://backend:8000", changeOrigin: true },
    },
  },
});
