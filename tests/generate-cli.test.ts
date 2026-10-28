// generate-cli.test.ts — scripts/generate.ts, the process entry behind
// `npm run generate`: relative paths resolve against the directory the
// caller ran npm from, not the package root npm switches into (#104).
// Spawned the way npm runs it: cwd = package root, INIT_CWD = caller's dir.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(__dirname, "..");
const tsx = join(repo, "node_modules", ".bin", "tsx");
const script = join(repo, "scripts", "generate.ts");

describe("npm run generate working directory (#104)", () => {
  it("resolves relative --values and --out against INIT_CWD", () => {
    const caller = mkdtempSync(join(tmpdir(), "generate-cwd-"));
    try {
      writeFileSync(join(caller, "probe-values.json"), JSON.stringify({ name: "Probe", barcode: "850051366224" }));
      const p = spawnSync(tsx, [script, "--values", "probe-values.json", "--out", "out", "--format", "pdf"], {
        cwd: repo, env: { ...process.env, INIT_CWD: caller }, encoding: "utf8",
      });
      expect(p.stderr).not.toMatch(/ENOENT/);
      expect(p.status).toBe(0);
      expect(existsSync(join(caller, "out", "probe.pdf"))).toBe(true);
      expect(existsSync(join(repo, "out", "probe.pdf"))).toBe(false);
      expect(existsSync(join(caller, "out", "probe-mask.pdf"))).toBe(false);
    } finally {
      rmSync(caller, { recursive: true, force: true });
    }
  }, 60_000);

  it("--two-file keeps the art and mask PDF pair", () => {
    const caller = mkdtempSync(join(tmpdir(), "generate-two-file-"));
    try {
      writeFileSync(join(caller, "probe-values.json"), JSON.stringify({ name: "Probe", barcode: "850051366224" }));
      const p = spawnSync(tsx, [script, "--values", "probe-values.json", "--out", "out", "--format", "pdf", "--two-file"], {
        cwd: repo, env: { ...process.env, INIT_CWD: caller }, encoding: "utf8",
      });
      expect(p.status).toBe(0);
      expect(existsSync(join(caller, "out", "probe.pdf"))).toBe(true);
      expect(existsSync(join(caller, "out", "probe-mask.pdf"))).toBe(true);
    } finally {
      rmSync(caller, { recursive: true, force: true });
    }
  }, 60_000);
});
