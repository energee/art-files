// vite.config.ts — React + Tailwind v4; "@" aliases src/ (shadcn convention).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import type { Plugin } from "vite";

/** Reusable styles and UPCs live in presets.json at the repo root rather than
 *  localStorage: they must survive a cleared browser profile, and git gives
 *  them history and review. This endpoint serves browser development; the
 *  packaged desktop app persists the same data through its Tauri backend. */
const PRESETS_FILE = fileURLToPath(new URL("./presets.json", import.meta.url));
/** Deliberately `{}` rather than a spelled-out empty library: the client's
 *  normalizePresets (src/presets.ts) fills in every key with its default, so
 *  restating the shape here would just be a second copy to keep in step. */
const EMPTY_PRESETS = "{}";

function presetsApi(): Plugin {
  return {
    name: "presets-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/presets", (req, res, next) => {
        if (req.method === "GET") {
          void readFile(PRESETS_FILE, "utf8")
            .catch(() => EMPTY_PRESETS) // absent file = nothing saved yet
            .then((body) => {
              res.setHeader("Content-Type", "application/json");
              res.end(body);
            });
          return;
        }
        if (req.method === "PUT") {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            // Parse before writing: a malformed body must not clobber the
            // file with something the next GET can't read back.
            try {
              JSON.parse(body);
            } catch {
              res.statusCode = 400;
              res.end('{"error":"invalid JSON"}');
              return;
            }
            void writeFile(PRESETS_FILE, `${body}\n`)
              .then(() => res.end('{"ok":true}'))
              .catch((err: Error) => {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              });
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), presetsApi()],
  // presets.json is data the running app writes, not a source file: without
  // this, saving a preset trips the watcher and full-reloads the page,
  // throwing away the config being edited.
  server: { watch: { ignored: ["**/presets.json", "**/src-tauri/**"] } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Scoped here rather than in the npm script's flags so EVERY entry point to
  // vitest (watch mode, IDE runners, bare `npx vitest`) skips suites in nested
  // git worktrees instead of failing against another tree's source.
  test: { dir: "tests" },
});
