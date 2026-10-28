// spotChannel.ts — adds the printer's White Ink spot channel to a finished PSD.
// ag-psd only writes RGB(A) composites, so this splices the channel into its
// bytes: the header's channel count, three image resources (the channel names
// 1006 and 1045, and DisplayInfo 1077, which makes White Ink a spot colour —
// laid out as Photoshop saves them, transparency listed first), and two more
// RLE channels after the composite's three — an opaque transparency channel,
// then the ink. Readers that take a 4th channel as alpha (macOS's Quick Look
// and Preview) would otherwise punch the ink out of the preview; the layer
// count's sign is flipped so Photoshop reads that 4th channel as the merged
// transparency, not a second named channel. Layers are untouched.
import { WHITE_INK } from "../layout";

/** `ink` holds one byte per document pixel, stored the way Photoshop stores a
 *  spot channel: 0 = 100% ink, 255 = none. The channel shows at 0% solidity,
 *  so Photoshop draws the art as-is on screen; it still separates. */
export function addWhiteInkChannel(psd: Uint8Array, ink: Uint8Array): Uint8Array {
  const v = new DataView(psd.buffer, psd.byteOffset, psd.byteLength);
  const channels = v.getUint16(12), height = v.getUint32(14), width = v.getUint32(18);
  // ponytail: assumes ag-psd's opaque 8-bit RGB composite (3 channels, PSD v1);
  // an alpha composite would make the merged transparency channel 4th.
  if (v.getUint16(4) !== 1 || channels !== 3) throw new Error("White Ink needs an opaque RGB PSD");
  if (ink.length !== width * height) throw new Error("White Ink must be one byte per pixel");

  const resStart = 26 + 4 + v.getUint32(26);
  const resEnd = resStart + 4 + v.getUint32(resStart);
  const imageStart = resEnd + 4 + v.getUint32(resEnd);
  if (v.getUint16(imageStart) !== 1) throw new Error("White Ink needs an RLE composite");
  const layerCount = v.getInt16(resEnd + 8); // after the section and layer-info lengths
  const countsEnd = imageStart + 2 + 2 * channels * height;

  const names = ["Transparency", WHITE_INK];
  const pascal = names.flatMap((n) => [n.length, ...new TextEncoder().encode(n)]);
  // Unicode strings: a length counting the trailing NUL, then UTF-16BE.
  const unicode = names.flatMap((n) => [...u32(n.length + 1),
    ...[...n].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]), 0, 0]);
  // Version 1, then per channel: colour space 0 (RGB), four 16-bit colour
  // components, solidity %, kind. Transparency as Photoshop writes it (red,
  // 100%, an ordinary channel); White Ink white at 0%, kind 2: spot.
  const displayInfo = [...u32(1),
    0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 100, 1,
    0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 2];
  const resources = [...resource(1006, pascal), ...resource(1045, unicode), ...resource(1077, displayInfo)];

  const counts: number[] = [];
  const rows: number[] = [];
  const opaque = new Uint8Array(width).fill(255);
  for (const plane of [() => opaque, (y: number) => ink.subarray(y * width, (y + 1) * width)])
    for (let y = 0; y < height; y++) {
      const row = packBits(plane(y));
      counts.push(row.length >> 8, row.length & 0xff);
      for (const byte of row) rows.push(byte);
    }

  const out = new Uint8Array(psd.length + resources.length + counts.length + rows.length);
  let o = 0;
  const put = (bytes: ArrayLike<number>) => { out.set(bytes, o); o += bytes.length; };
  put(psd.subarray(0, resStart));
  new DataView(out.buffer).setUint16(12, channels + 2);
  put(u32(resEnd - resStart - 4 + resources.length));
  put(psd.subarray(resStart + 4, resEnd));
  put(resources);
  put(psd.subarray(resEnd, countsEnd));
  new DataView(out.buffer).setInt16(resEnd + resources.length + 8, -Math.abs(layerCount));
  put(counts);
  put(psd.subarray(countsEnd));
  put(rows);
  return out;
}

const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** One 8BIM image resource with an empty name, its data padded to even. */
function resource(id: number, data: ArrayLike<number>): number[] {
  return [0x38, 0x42, 0x49, 0x4d, id >> 8, id & 0xff, 0, 0, ...u32(data.length),
    ...Array.from(data), ...(data.length & 1 ? [0] : [])];
}

/** PackBits, as PSD's RLE composite rows use: runs of 2-128 repeats and
 *  literal stretches of up to 128 bytes. */
function packBits(row: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    let run = 1;
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++;
    if (run > 1) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    const start = i++;
    while (i < row.length && i - start < 128 && row[i] !== row[i + 1]) i++;
    out.push(i - start - 1);
    for (let k = start; k < i; k++) out.push(row[k]);
  }
  return out;
}
