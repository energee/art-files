// configure-updater.mjs — injects the public updater key into an ignored,
// release-only Tauri config without ever writing private material to the repo.
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
await writeFile(outputUrl, `${JSON.stringify(config, null, 2)}\n`);
