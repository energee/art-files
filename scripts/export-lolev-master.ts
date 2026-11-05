// export-lolev-master.ts — one-off, rerunnable: writes the built-in Lolev
// master (lolevMaster()) to masters/lolev.master so the app can stop shipping
// it. The laurel layer's asset (LOGO_ASSET) is packed with the bytes of
// src/assets/logo2025.svg. Run: npx tsx scripts/export-lolev-master.ts
// (tests/lolev-master-file.test.ts checks the committed output).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packMaster } from "../src/model/files";
import { LOGO_ASSET, lolevMaster } from "../tests/fixtures/lolevMaster";

const root = join(import.meta.dirname, "..");
const master = lolevMaster();
const bytes = new Uint8Array(readFileSync(join(root, "src", "assets", "logo2025.svg")));

mkdirSync(join(root, "masters"), { recursive: true });
writeFileSync(join(root, "masters", "lolev.master"),
  packMaster(master, { customImages: { [LOGO_ASSET]: { name: "logo2025.svg", bytes } } }));
