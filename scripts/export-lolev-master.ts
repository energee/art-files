// export-lolev-master.ts — one-off, rerunnable: writes the built-in Lolev
// master (lolevMaster()) to masters/lolev.master so the app can stop shipping
// it. The laurel's `builtin:logo` becomes an ordinary SVG image asset carrying
// src/assets/logo2025.svg; nothing else changes. Run: npx tsx scripts/export-lolev-master.ts
// (tests/lolev-master-file.test.ts checks the committed output).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packMaster } from "../src/model/files";
import type { ImageLayer } from "../src/model/layers";
import { lolevMaster } from "../src/model/lolevLayers";

/** Fixed rather than minted (App.tsx mintCustomAssetId), so a rerun writes
 *  the same file. */
const LOGO_ASSET = "custom-asset-laurel";

const root = join(import.meta.dirname, "..");
const master = lolevMaster();
const logo = master.layers.find((l) => l.id === "logo") as ImageLayer;
logo.asset = LOGO_ASSET;
const bytes = new Uint8Array(readFileSync(join(root, "src", "assets", "logo2025.svg")));

mkdirSync(join(root, "masters"), { recursive: true });
writeFileSync(join(root, "masters", "lolev.master"),
  packMaster(master, { customImages: { [LOGO_ASSET]: { name: "logo2025.svg", bytes } } }));
