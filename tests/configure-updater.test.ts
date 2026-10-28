// configure-updater.test.ts — the release config generator: the updater key
// always, the Windows Artifact Signing command only when all three settings are
// given, and a half-set signing config fails the build instead of shipping
// unsigned (#397).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const generated = new URL("../src-tauri/tauri.release.generated.conf.json", import.meta.url);

function configure(env: Record<string, string>) {
  execFileSync("node", ["scripts/configure-updater.mjs"], {
    env: { PATH: process.env.PATH, TAURI_UPDATER_PUBLIC_KEY: "test-key", ...env },
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(generated, "utf8"));
}

it("leaves Windows unsigned without the Artifact Signing settings", () => {
  const config = configure({});
  expect(config.plugins.updater.pubkey).toBe("test-key");
  expect(config.bundle.windows).toBeUndefined();
});

it("adds the artifact-signing-cli sign command when all three are set", () => {
  const config = configure({
    AZURE_TRUSTED_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net",
    AZURE_TRUSTED_SIGNING_ACCOUNT: "acct",
    AZURE_TRUSTED_SIGNING_PROFILE: "prof",
  });
  expect(config.bundle.windows.signCommand).toBe(
    "artifact-signing-cli -e https://eus.codesigning.azure.net -a acct -c prof %1");
});

it("refuses a half-set signing config", () => {
  expect(() => configure({ AZURE_TRUSTED_SIGNING_ACCOUNT: "acct" })).toThrow(/or none/);
});
