// dev-pages.test.ts — dev-only HTML pages (the strokecap magnifier) live under
// tools/, not the repo root, and the npm script that opens one must point at a
// page that exists and loads a script that exists. Vite serves the repo root,
// so "/tools/x.html" and "/src/dev/x.ts" are root-relative paths on disk.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

describe("strokecap dev page", () => {
  it("is not in the repo root", () => {
    expect(existsSync("strokecap.html")).toBe(false);
  });

  it("is opened by npm run strokecap from tools/, and its script exists", () => {
    const page = /--open\s+\/(\S+\.html)/.exec(pkg.scripts.strokecap)?.[1];
    expect(page).toBe("tools/strokecap.html");
    const html = readFileSync(page!, "utf8");
    const src = /<script[^>]*src="\/([^"]+)"/.exec(html)?.[1];
    expect(src && existsSync(src)).toBe(true);
  });
});
