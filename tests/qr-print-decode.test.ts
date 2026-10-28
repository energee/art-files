// The actual PDF geometry and keyline of the shipped dots QR.
// Software decoding does not replace the physical phone check in #283.
// #542: at error correction L the keylined gold dots decoded for 6 of 30
// ordinary names (the black keyline makes the gold module centres read
// light); the shipped master's Q decodes every one, so a name corpus guards it.
import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm")) } });
import { buildArtPdf } from "../src/pdf/build";
import { lolevMaster } from "../src/model/lolevLayers";
import { qrUrl } from "../src/qr";
import { assets, lolevPlan } from "./fixtures";

/** Ordinary beer names of every length the shipped layout takes. */
const NAMES = ["Audit Labradorite", "Lupula", "Hazy", "Obsidian Stout", "Double Dry Hopped Citra",
  "Golden Hour Lager", "Pils", "Kölsch", "Big Bad Barleywine Reserve", "Topaz IPA"];

function rotate(data: Uint8ClampedArray, side: number) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++)
    out.set(data.subarray((y * side + x) * 4, (y * side + x) * 4 + 4), (x * side + side - 1 - y) * 4);
  return out;
}

/** The shipped QR for `name`, built to a real PDF, rasterized at 600 DPI by
 *  Poppler and read by ZXing; the decoded text at the first orientation that
 *  reads (finder search on ring finders can be orientation-sensitive, so
 *  retry turns without changing any symbol or surrounding pixel). */
async function printedQr(name: string, rotation: 0 | 90): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "qr-print-"));
  try {
    const plan = await lolevPlan({ values: { name }, overrides: { qr: { rotation } } });
    const qrItems = plan.filter((p) => p.id === "qr");
    const qr = qrItems[0];
    const layer = lolevMaster().layers.find((l) => l.id === "qr")!;
    if (layer.kind !== "qr") throw new Error("Expected the QR layer");
    if (qr.kind !== "paths") throw new Error("Expected the QR path");
    writeFileSync(join(dir, "qr.pdf"), await buildArtPdf(qrItems, assets));
    const scale = 600 / 72, margin = 10;
    const side = Math.ceil((layer.size + 2 * margin) * scale);
    const p = spawnSync("pdftoppm", ["-png", "-singlefile", "-r", "600", "-x", String(Math.floor((qr.x - margin) * scale)), "-y", String(Math.floor((qr.y - margin) * scale)), "-W", String(side), "-H", String(side), join(dir, "qr.pdf"), join(dir, "qr")]);
    if (p.error) throw p.error;
    expect(p.status, p.stderr.toString()).toBe(0);
    const png = PNG.sync.read(readFileSync(join(dir, "qr.png")));
    let data = new Uint8ClampedArray(png.data);
    let decoded: string | undefined;
    for (let turn = 0; turn < 4 && !decoded; turn++) {
      decoded = (await readBarcodes({ data, width: png.width, height: png.height } as ImageData, { formats: ["QRCode"], tryHarder: true }))[0]?.text;
      data = rotate(data, png.width);
    }
    return decoded;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

it.each([0, 90])("decodes the printed dots QR at %s degrees (#295)", async (rotation) => {
  expect(await printedQr("Labradorite", rotation as 0 | 90)).toBe("https://lolev.beer/beer/labradorite");
});

it("decodes the printed dots QR for every name in the corpus (#542)", async () => {
  const misses: string[] = [];
  for (const name of NAMES) if (await printedQr(name, 0) !== qrUrl(name)) misses.push(name);
  expect(misses).toEqual([]);
}, 60_000);

it.each([0, 90])("decodes a stroked UPC with no quiet-zone plate at %s degrees", async (rotation) => {
  const dir = mkdtempSync(join(tmpdir(), "barcode-print-"));
  try {
    const plan = await lolevPlan({ overrides: { barcode: { x: 100, y: 100, anchor: "left", rotation: rotation as 0 | 90 } } });
    const items = plan.filter((p) => p.id === "barcode");
    expect(items.map((p) => p.kind)).toEqual(["barcode"]);
    const barcode = items[0];
    if (barcode.kind !== "barcode") throw new Error("Missing barcode");
    const rects = barcode.footprint;
    const x = Math.min(...rects.map((r) => r.x)) - 15;
    const y = Math.min(...rects.map((r) => r.yTop)) - 15;
    const right = Math.max(...rects.map((r) => r.x + r.w)) + 15;
    const bottom = Math.max(...rects.map((r) => r.yTop + r.h)) + 15;
    writeFileSync(join(dir, "barcode.pdf"), await buildArtPdf(items, assets));
    const scale = 600 / 72;
    const p = spawnSync("pdftoppm", ["-png", "-singlefile", "-r", "600", "-x", String(Math.floor(x * scale)), "-y", String(Math.floor(y * scale)), "-W", String(Math.ceil((right - x) * scale)), "-H", String(Math.ceil((bottom - y) * scale)), join(dir, "barcode.pdf"), join(dir, "barcode")]);
    if (p.error) throw p.error;
    expect(p.status, p.stderr.toString()).toBe(0);
    const png = PNG.sync.read(readFileSync(join(dir, "barcode.png")));
    const decoded = await readBarcodes({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height } as ImageData, { formats: ["UPCA"], tryHarder: true });
    expect(decoded[0]?.text).toBe("0" + barcode.digits.map((d) => d.text).join(""));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
