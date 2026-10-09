// CI, release-metadata and release builds must run one Node version, read from
// .nvmrc, instead of each workflow naming its own (ci.yml said 24 while the
// release used lts/*, so a new LTS could ship a binary CI never tested, #423).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const WORKFLOWS = resolve(ROOT, ".github/workflows");

describe("one pinned Node version (#423)", () => {
  const text = new Map(
    readdirSync(WORKFLOWS)
      .filter((f) => f.endsWith(".yml"))
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
      expect(step).not.toMatch(/node-version:/);
    }
  });

  it(".nvmrc names a major that package.json engines accepts", () => {
    const major = Number(readFileSync(resolve(ROOT, ".nvmrc"), "utf8").trim());
    const engines = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).engines.node as string;
    const floor = Number(/>=\s*(\d+)/.exec(engines)?.[1]);
    expect(Number.isInteger(major)).toBe(true);
    expect(major).toBeGreaterThanOrEqual(floor);
  });
});
