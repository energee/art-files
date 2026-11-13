// web-app-publish.test.ts — the web app's publish contract (spec: phone layout,
// phase 1): web-app.yml builds a named label-lab release tag for /art-files/app/
// and hands dist/ to the feed workflows as the web-app artifact.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

describe("web-app.yml", () => {
  const yml = read("web-app.yml");
  it("is reusable and takes an optional tag", () => {
    expect(yml).toMatch(/workflow_call:/);
    expect(yml).toMatch(/workflow_call:\s*\n\s*inputs:\s*\n\s*tag:/);
  });
  it("accepts only label-lab release tags", () => {
    expect(yml).toContain("^label-lab-v[0-9]+\\.[0-9]+\\.[0-9]+$");
  });
  it("checks out the tag before installing or building", () => {
    const at = (s: string) => {
      const i = yml.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    expect(at('git checkout "$tag"')).toBeLessThan(at("npm ci"));
    expect(at("npm ci")).toBeLessThan(at("npm run build -- --base=/art-files/app/"));
  });
  it("uploads dist as the web-app artifact", () => {
    expect(yml).toMatch(/name: web-app\b/);
    expect(yml).toMatch(/path: dist\b/);
  });
});
