/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GitHub Pages serves from /<repo-name>/, so we need a base path in production.
// During `npm run dev`, base is "/" (no prefix). On build (GitHub Actions sets
// NODE_ENV=production), we use /altronic-arc/ (the GitHub repo name).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? "/altronic-arc/" : "/",
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
  // Vitest configuration. The project standard is 100% unit-test coverage —
  // see memory feedback_testing.md. Coverage thresholds are intentionally
  // unset here until the existing codebase is backfilled; once backfill is
  // done, switch the `thresholds` block on to gate CI.
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Vitest's default is 5s, which is comfortable on a dev machine and NOT on
    // a GitHub runner — fewer cores, shared CPU, and the whole suite competing
    // for them. The maintenance views render 150-170 rows and re-render the lot
    // on a click; those tests pass locally and time out in CI.
    //
    // Three of them had already been hand-raised to 20s one at a time, which is
    // the symptom of a class problem rather than three flaky tests. Setting it
    // globally is the honest fix: CI is uniformly slower, so per-test raises are
    // whack-a-mole and the next heavy view starts the loop again.
    //
    // This does NOT mask a hang — a genuinely stuck test still fails, just 15s
    // later. Nothing here is waiting on a network or a timer.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Bootstrap / type-only / data fixtures — not unit-testable on their own.
        "src/main.tsx",
        "src/test/**",
        "src/**/*.d.ts",
        "src/vite-env.d.ts",
        "src/data/changelog.ts",
        "src/data/mockData.ts",
        "src/**/*.test.{ts,tsx}",
      ],
      // Turn these on after the existing-code backfill lands:
      // thresholds: {
      //   lines: 100,
      //   branches: 100,
      //   functions: 100,
      //   statements: 100,
      // },
    },
  },
}));
