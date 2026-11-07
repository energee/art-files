// check-release-dependencies.test.ts — a pure dependency bump needs no release
// note, and anything else in the same diff still does.
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FILES = [
  "CHANGELOG.md", "package.json", "package-lock.json", "scripts/check-release.mjs", "scripts/release-notes.mjs",
  "src-tauri/Cargo.lock", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json",
];
const repos: string[] = [];

/** A throwaway repo holding the release files, committed so HEAD is the base. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "check-release-"));
  repos.push(dir);
  for (const file of FILES) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(resolve(file), join(dir, file));
  }
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base");
  return dir;
}

const check = (dir: string) => spawnSync("node", ["scripts/check-release.mjs", "HEAD"], { cwd: dir, encoding: "utf8" });

afterEach(() => { for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("check-release on a dependency bump", () => {
  it.each(["package-lock.json", "src-tauri/Cargo.lock"])("passes with no note when only %s changed", (file) => {
    const dir = repo();
    appendFileSync(join(dir, file), "\n");
    expect(check(dir).status).toBe(0);
  });

  it("still asks for a note when app code changes with it", () => {
    const dir = repo();
    appendFileSync(join(dir, "package-lock.json"), "\n");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/app.ts"), "");
    const run = check(dir);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("CHANGELOG.md was not updated");
  });
});
