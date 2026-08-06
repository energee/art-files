// vite.config.ts — React + Tailwind v4; "@" aliases src/ (shadcn convention).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import type { Plugin } from "vite";

/** Reusable styles and UPCs live in presets.json at the repo root rather than
 *  localStorage: they must survive a cleared browser profile, and git gives
 *  them history and review. Dev-server only — the app runs locally, so there
 *  is no deployed build that would need a real backend for this. */
const PRESETS_FILE = fileURLToPath(new URL("./presets.json", import.meta.url));
const EMPTY_PRESETS = '{"styles":[],"barcodes":[]}';

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
  server: { watch: { ignored: ["**/presets.json"] } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
