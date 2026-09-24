// vite-config.test.ts — the dev server must own the port Tauri's devUrl loads.
// Reads vite.config.ts as text: importing it pulls the config into
// `tsc --noEmit`, where vitest's nested vite 5 types clash with the vite 6
// plugin types and fail CI.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import tauri from "../src-tauri/tauri.conf.json";

const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

describe("dev server port", () => {
  it("binds exactly the devUrl port and refuses to fall back to another one", () => {
    // Without strictPort, a second Vite already on 5173 bumps ours to 5174 and
    // the Tauri window loads the *other* session's app from 5173 (#107).
    const devPort = new URL(tauri.build.devUrl).port;
    expect(config).toMatch(new RegExp(`server:\\s*\\{[^}]*\\bport:\\s*${devPort}\\b`));
    expect(config).toMatch(/server:\s*\{[^}]*\bstrictPort:\s*true\b/);
  });

  it("keeps vitest scoped to tests/", () => {
    expect(config).toMatch(/\bdir:\s*"tests"/);
  });
});
