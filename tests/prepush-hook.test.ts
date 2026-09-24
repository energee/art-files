// prepush-hook.test.ts — .githooks/pre-push checks the commits being pushed,
// not the working tree: uncommitted files must neither block a clean push nor
// hide a bad one (#113). Runs the real hook in a throwaway git repo.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const ZERO = "0".repeat(40);

let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

function write(path: string, text: string) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** The five synchronized version files plus a changelog section for it. */
function writeVersion(version: string, changelog: string) {
  write("package.json", JSON.stringify({ name: "label-lab", version }));
  write("package-lock.json", JSON.stringify({ version, packages: { "": { version } } }));
  write("src-tauri/Cargo.toml", `[package]\nname = "label-lab"\nversion = "${version}"\n`);
  write("src-tauri/Cargo.lock", `[[package]]\nname = "label-lab"\nversion = "${version}"\n`);
  write("src-tauri/tauri.conf.json", JSON.stringify({ version }));
  write("CHANGELOG.md", changelog);
}

/** Run the hook as git would for `git push origin <branch>`. */
function pushBranch(branch: string) {
  const sha = git("rev-parse", branch);
  return spawnSync("sh", [".githooks/pre-push", "origin", "unused-url"], {
    cwd: repo,
    encoding: "utf8",
    input: `refs/heads/${branch} ${sha} refs/heads/${branch} ${ZERO}\n`,
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "prepush-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  // The whole scripts/ dir, so the checker's own imports come along.
  for (const dir of [".githooks", "scripts"]) cpSync(join(ROOT, dir), join(repo, dir), { recursive: true });
  writeVersion("0.1.0", "# Changelog\n\n## [0.1.0] - 2026-01-01\n- First.\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-qb", "feat");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

// Each case spawns git and node several times; allow for a loaded machine.
describe("pre-push hook", { timeout: 60_000 }, () => {
  it("passes a clean commit even when the working tree has uncommitted binary changes", () => {
    write("notes.md", "docs only\n");
    git("add", "notes.md");
    git("commit", "-qm", "docs");
    write("src/wip.ts", "export const wip = 1;\n"); // untracked, not pushed

    const result = pushBranch("feat");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("fails a binary commit without a bump even when the working tree holds the bump", () => {
    write("src/app.ts", "export const app = 1;\n");
    git("add", "src/app.ts");
    git("commit", "-qm", "binary change, no bump");
    // Uncommitted bump + changelog: present locally, absent from the push.
    writeVersion("0.1.1", "# Changelog\n\n## [0.1.1] - 2026-01-02\n- Fix.\n\n## [0.1.0] - 2026-01-01\n- First.\n");

    const result = pushBranch("feat");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/binary-impacting files changed/);
  });

  it("checks the pushed branch, not the checked-out one", () => {
    git("checkout", "-qb", "other");
    write("src/app.ts", "export const app = 1;\n");
    git("add", "src/app.ts");
    git("commit", "-qm", "binary change, no bump");
    git("checkout", "-q", "feat"); // clean branch checked out; push `other`

    const result = pushBranch("other");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/binary-impacting files changed/);
  });
});
