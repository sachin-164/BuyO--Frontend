import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Same-origin API in production; proxy to the Express server in dev.
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      // Locally stored product images (the Express static driver). Hosted
      // deployments use absolute Supabase URLs and never hit this.
      "/uploads": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // Do not publish source maps with the production bundle. They add several
    // megabytes and expose the original source tree without an error-reporting
    // service that needs them.
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
