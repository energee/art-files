// dev-pages.test.ts — dev-only HTML pages (the strokecap magnifier) live under
// tools/, not the repo root, and the npm script that opens one must point at a
// page that exists and loads a script that exists. Vite serves the repo root,
// so "/tools/x.html" and "/src/dev/x.ts" are root-relative paths on disk.
// Paths resolve from this file, not the cwd, so the checks hold under any runner.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

describe("strokecap dev page", () => {
  it("is not in the repo root", () => {
    expect(existsSync(resolve(ROOT, "strokecap.html"))).toBe(false);
  });

  it("is opened by npm run strokecap from tools/, and its script exists", () => {
    // Vite accepts `--open tools/x.html` with or without the leading slash.
    const page = /--open\s+\/?(\S+\.html)/.exec(pkg.scripts.strokecap)?.[1];
    expect(page).toBe("tools/strokecap.html");
    const html = readFileSync(resolve(ROOT, page!), "utf8");
    const src = /<script[^>]*src="\/([^"]+)"/.exec(html)?.[1];
    expect(src && existsSync(resolve(ROOT, src))).toBe(true);
  });
});
