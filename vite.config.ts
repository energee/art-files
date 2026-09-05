// vite.config.ts — React + Tailwind v4; "@" aliases src/ (shadcn convention).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { watch: { ignored: ["**/src-tauri/**"] } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Scoped here rather than in the npm script's flags so EVERY entry point to
  // vitest (watch mode, IDE runners, bare `npx vitest`) skips suites in nested
  // git worktrees instead of failing against another tree's source.
  test: { dir: "tests" },
});
