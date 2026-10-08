// Local-only files that must never be committed or linted: stray pnpm
// lockfiles beside package-lock.json, and the .remember/ session scratch
// directory (its .ts scratch files broke `npm run lint`, #420).
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Both checks resolve paths against the repo root, not whatever directory
// vitest was started from.
const ROOT = resolve(__dirname, "..");
const LOCAL_ONLY = ["pnpm-lock.yaml", "pnpm-workspace.yaml", ".remember/tmp/last-ndc.ts"];

describe("local-only files (#420)", () => {
  it.each(LOCAL_ONLY)("git ignores %s", (path) => {
    // check-ignore exits 0 when the path is ignored, 1 when it is not.
    expect(() => execFileSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: ROOT })).not.toThrow();
  });

  it("eslint ignores .remember/", async () => {
    expect(await new ESLint({ cwd: ROOT }).isPathIgnored(".remember/tmp/last-ndc.ts")).toBe(true);
  });
});
