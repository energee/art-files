// CI, release-metadata and release builds must run one Node version, read from
// .nvmrc, instead of each workflow naming its own (ci.yml said 24 while the
// release used lts/*, so a new LTS could ship a binary CI never tested, #423).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const WORKFLOWS = resolve(ROOT, ".github/workflows");

/** "24", "v24.11" or "24.11.0" as [major, minor, patch]; a missing part is
 * Infinity because setup-node resolves it to the newest release. */
function nvmrcVersion(text: string): number[] {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`.nvmrc must name a version number, got ${JSON.stringify(text)}`);
  return match.slice(1).map((part) => (part === undefined ? Infinity : Number(part)));
}

/** True when version `a` is at least `b`, part by part. */
function atLeast(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

describe("one pinned Node version (#423)", () => {
  const text = new Map(
    readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(resolve(WORKFLOWS, f), "utf8")]),
  );
  const withSetupNode = [...text.keys()].filter((f) => text.get(f)!.includes("actions/setup-node"));

  it("covers the CI and release workflows", () => {
    expect(withSetupNode).toEqual(expect.arrayContaining(["ci.yml", "release.yml", "release-metadata.yml"]));
  });

  it.each(withSetupNode)("%s reads the version from .nvmrc", (file) => {
    // Split the workflow into its `- ` list items and keep the setup-node steps.
    const steps = text
      .get(file)!
      .split(/\n\s*- /)
      .filter((step) => step.includes("actions/setup-node"));
    for (const step of steps) {
      expect(step).toMatch(/node-version-file:\s*\.nvmrc/);
      // A key at line start, so a comment that mentions it doesn't count.
      expect(step).not.toMatch(/^\s*node-version:/m);
    }
  });

  it(".nvmrc names a version that package.json engines accepts", () => {
    const pinned = nvmrcVersion(readFileSync(resolve(ROOT, ".nvmrc"), "utf8"));
    const engines = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).engines.node as string;
    const floor = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(engines.trim());
    expect(floor, `engines.node ${engines} is not a >=x.y.z floor; update this test`).not.toBeNull();
    expect(atLeast(pinned, floor!.slice(1).map(Number))).toBe(true);
  });

  it("parses the .nvmrc forms setup-node accepts", () => {
    expect(nvmrcVersion("24\n")).toEqual([24, Infinity, Infinity]);
    expect(nvmrcVersion("v24.11.0")).toEqual([24, 11, 0]);
    expect(atLeast(nvmrcVersion("24"), [24, 2, 0])).toBe(true);
    expect(atLeast(nvmrcVersion("24.11.0"), [24, 2, 0])).toBe(true);
    expect(atLeast(nvmrcVersion("24.1.0"), [24, 2, 0])).toBe(false);
    expect(atLeast(nvmrcVersion("23"), [24, 2, 0])).toBe(false);
    expect(() => nvmrcVersion("lts/jod")).toThrow();
  });
});
