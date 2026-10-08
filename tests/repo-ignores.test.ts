// Local-only files that must never be committed or linted: stray pnpm
// lockfiles beside package-lock.json, and the .remember/ session scratch
// directory (its .ts scratch files broke `npm run lint`, #420).
import { execFileSync } from "node:child_process";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const LOCAL_ONLY = ["pnpm-lock.yaml", "pnpm-workspace.yaml", ".remember/tmp/last-ndc.ts"];

describe("local-only files (#420)", () => {
  it.each(LOCAL_ONLY)("git ignores %s", (path) => {
    // check-ignore exits 0 when the path is ignored, 1 when it is not.
    expect(() => execFileSync("git", ["check-ignore", "-q", "--no-index", path])).not.toThrow();
  });

  it("eslint ignores .remember/", async () => {
    expect(await new ESLint().isPathIgnored(".remember/tmp/last-ndc.ts")).toBe(true);
  });
});
