// configure-updater.mjs — injects the public updater key into an ignored,
// release-only Tauri config without ever writing private material to the repo,
// plus the Windows sign command once Azure Trusted Signing is configured (#397;
// see the signing steps in .github/workflows/release.yml).
import { readFile, writeFile } from "node:fs/promises";

const templateUrl = new URL("../src-tauri/tauri.release.conf.json", import.meta.url);
const outputUrl = new URL("../src-tauri/tauri.release.generated.conf.json", import.meta.url);
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();

if (!publicKey) {
  throw new Error("TAURI_UPDATER_PUBLIC_KEY is required to configure a release build.");
}

const config = JSON.parse(await readFile(templateUrl, "utf8"));
if (config.plugins?.updater?.pubkey !== "__TAURI_UPDATER_PUBLIC_KEY__") {
  throw new Error("The updater public-key placeholder is missing from the release config.");
}
config.plugins.updater.pubkey = publicKey;

const signing = ["ENDPOINT", "ACCOUNT", "PROFILE"].map((k) => process.env[`AZURE_TRUSTED_SIGNING_${k}`]?.trim());
if (signing.some(Boolean)) {
  if (!signing.every(Boolean)) {
    throw new Error("Set all of AZURE_TRUSTED_SIGNING_ENDPOINT, _ACCOUNT and _PROFILE, or none.");
  }
  const [endpoint, account, profile] = signing;
  // tauri runs this on each file it signs, %1 being the file.
  config.bundle.windows = {
    signCommand: `trusted-signing-cli -e ${endpoint} -a ${account} -c ${profile} -d "Label Lab" %1`,
  };
}
await writeFile(outputUrl, `${JSON.stringify(config, null, 2)}\n`);
