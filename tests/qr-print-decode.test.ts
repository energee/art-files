// The actual PDF geometry and keyline of the shipped dots QR.
// Software decoding does not replace the physical phone check in #283.
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
import { assets, lolevPlan } from "./fixtures";

function rotate(data: Uint8ClampedArray, side: number) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++)
    out.set(data.subarray((y * side + x) * 4, (y * side + x) * 4 + 4), (x * side + side - 1 - y) * 4);
  return out;
}
it.each([0, 90])("decodes the printed dots QR at %s degrees (#295)", async (rotation) => {
  const dir = mkdtempSync(join(tmpdir(), "qr-print-"));
  try {
    const plan = await lolevPlan({ values: { name: "Labradorite" }, overrides: { qr: { rotation: rotation as 0 | 90 } } });
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
    // Finder search can be orientation-sensitive for ring/dot finders.
    // Retry orientations without changing any symbol or surrounding pixels.
    let decoded: string | undefined;
    for (let turn = 0; turn < 4 && !decoded; turn++) {
      decoded = (await readBarcodes({ data, width: png.width, height: png.height } as ImageData, { formats: ["QRCode"], tryHarder: true }))[0]?.text;
      data = rotate(data, png.width);
    }
    expect(decoded).toBe("https://lolev.beer/beer/labradorite");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.each([0, 90])("decodes a backed UPC over dark texture at %s degrees (#284)", async (rotation) => {
  const dir = mkdtempSync(join(tmpdir(), "barcode-print-"));
  try {
    const plan = await lolevPlan({ overrides: { barcode: { x: 100, y: 100, anchor: "left", rotation: rotation as 0 | 90 } } });
    const items = plan.filter((p) => p.id === "barcode");
    const barcode = items.find((p) => p.kind === "barcode")!;
    const backing = items[0];
    expect(backing.kind).toBe("paths");
    if (backing.kind !== "paths" || barcode.kind !== "barcode") throw new Error("Missing barcode backing");
    expect(backing.layer).toBe(barcode.strokeLayer);
    // Bars keep their original locations; the backing extends at least 9X
    // beyond the guard on both ends of the scan direction.
    const first = Math.min(...barcode.geo.bars.map((r) => barcode.rotated ? r.yTop : r.x));
    expect(first - (barcode.rotated ? backing.y : backing.x)).toBeCloseTo(9 * barcode.geo.mod, 5);
    const rects = barcode.footprint;
    const right = Math.max(...rects.map((r) => r.x + r.w)) + 15;
    const bottom = Math.max(...rects.map((r) => r.yTop + r.h)) + 15;
    const background = { ...backing, id: "texture", x: 0, y: 0, paths: ["M0 0L600 0L600 400L0 400Z"], fill: "#182030" as const, stroke: null };
    writeFileSync(join(dir, "barcode.pdf"), await buildArtPdf([background, ...items], assets));
    const scale = 600 / 72, x = backing.x - 15, y = backing.y - 15;
    const p = spawnSync("pdftoppm", ["-png", "-singlefile", "-r", "600", "-x", String(Math.floor(x * scale)), "-y", String(Math.floor(y * scale)), "-W", String(Math.ceil((right - x) * scale)), "-H", String(Math.ceil((bottom - y) * scale)), join(dir, "barcode.pdf"), join(dir, "barcode")]);
    if (p.error) throw p.error;
    expect(p.status, p.stderr.toString()).toBe(0);
    const png = PNG.sync.read(readFileSync(join(dir, "barcode.png")));
    const decoded = await readBarcodes({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height } as ImageData, { formats: ["UPCA"], tryHarder: true });
    expect(decoded[0]?.text).toBe("0" + barcode.digits.map((d) => d.text).join(""));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
