// vite.config.ts — React + Tailwind v4; "@" aliases src/ (shadcn convention).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pinned to tauri.conf.json's devUrl port. strictPort makes a busy 5173 an
  // error instead of a silent hop to 5174, which would leave the Tauri window
  // loading whatever other Vite app holds 5173. `vitest run` opens no server,
  // and an explicit `--port` flag still overrides this for a browser-only copy.
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Scoped here rather than in the npm script's flags so EVERY entry point to
  // vitest (watch mode, IDE runners, bare `npx vitest`) skips suites in nested
  // git worktrees instead of failing against another tree's source.
  // fakeTimers: vitest 3+ also fakes requestAnimationFrame/performance by
  // default, which freezes Base UI's dialog exit animation under
  // vi.useFakeTimers(); keep the vitest 2 set the timer tests were written for.
  test: {
    dir: "tests",
    // Marks every suite as a React act() environment (see tests/setup.ts).
    setupFiles: ["tests/setup.ts"],
    fakeTimers: { toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "Date"] },
  },
});
