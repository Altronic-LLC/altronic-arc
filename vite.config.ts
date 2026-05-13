import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GitHub Pages serves from /<repo-name>/, so we need a base path in production.
// During `npm run dev`, base is "/" (no prefix). On build (GitHub Actions sets
// NODE_ENV=production), we use /altronic-engineering-tasks/.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? "/altronic-engineering-tasks/" : "/",
  resolve: {
    // Mirror the `@/*` alias declared in tsconfig.json so Rollup can resolve
    // imports during production builds (Vite dev relies on tsconfig directly
    // in some setups, but the build is stricter).
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // fail loudly if 5173 is taken — important because the
    // OAuth redirect URI is hard-coded to localhost:5173
  },
}));
