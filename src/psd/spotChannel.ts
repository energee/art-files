// spotChannel.ts — adds the printer's White Ink spot channel to a finished PSD.
// ag-psd only writes RGB(A) composites, so this splices the channel into its
// bytes: the header's channel count, four image resources (the channel names
// 1006 and 1045, Alpha Identifiers 1053, and DisplayInfo 1077, which makes
// White Ink a spot colour — laid out as Photoshop saves them, transparency
// listed first), and two more RLE channels after the composite's three — an
// opaque transparency channel, then the ink. Readers that take a 4th channel
// as alpha (macOS's Quick Look and Preview) would otherwise punch the ink out
// of the preview; the layer count's sign is flipped and 1053 gives the
// transparency id 0, so Photoshop and psd-tools-style readers take that 4th
// channel as the merged transparency, not White Ink. Layers are untouched.
import type { PixelData } from "ag-psd";
import { writeDataRLE } from "ag-psd/dist-es/helpers";
import { WHITE_INK } from "../layout";

/** `mask` is the White Ink plate flattened at document size (RGBA). Its red
 *  channel is the ink, already the way Photoshop stores a spot channel:
 *  0 (blue) = 100% ink, 255 (white) = none — the print PDF's rule
 *  (embedWhiteInkMask). The channel shows at 0% solidity, so Photoshop draws
 *  the art as-is on screen; it still separates. */
export function addWhiteInkChannel(psd: Uint8Array, mask: PixelData): Uint8Array {
  const v = new DataView(psd.buffer, psd.byteOffset, psd.byteLength);
  const channels = v.getUint16(12), height = v.getUint32(14), width = v.getUint32(18);
  // ponytail: assumes ag-psd's opaque 8-bit RGB composite (3 channels, PSD v1);
  // an alpha composite would make the merged transparency channel 4th.
  if (v.getUint16(4) !== 1 || channels !== 3) throw new Error("White Ink needs an opaque RGB PSD");
  if (mask.width !== width || mask.height !== height) throw new Error("White Ink plate must match the document size");

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
  // One id per channel; 0 marks the merged transparency (any other id names
  // an ordinary channel; Photoshop numbered its White Ink 69).
  const alphaIds = [...u32(0), ...u32(1)];
  const resources = [...resource(1006, pascal), ...resource(1045, unicode),
    ...resource(1053, alphaIds), ...resource(1077, displayInfo)];

  // The opaque plane is the same packed row every time; the ink plane is
  // the mask's red channel (RGBA offset 0), encoded by ag-psd: 2-byte row
  // lengths, then the rows. Worst case PackBits adds one header per 128.
  const row = opaqueRow(width);
  const ink = writeDataRLE(new Uint8Array(height * (2 + width + Math.ceil(width / 128))), mask, [0], false)!;
  const counts = new Uint8Array(4 * height);
  for (let y = 0; y < height; y++) counts.set([row.length >> 8, row.length & 0xff], 2 * y);
  counts.set(ink.subarray(0, 2 * height), 2 * height);

  const out = new Uint8Array(psd.length + resources.length + counts.length + row.length * height + ink.length - 2 * height);
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
  for (let y = 0; y < height; y++) put(row);
  put(ink.subarray(2 * height));
  return out;
}

const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** One 8BIM image resource with an empty name, its data padded to even. */
function resource(id: number, data: ArrayLike<number>): number[] {
  return [0x38, 0x42, 0x49, 0x4d, id >> 8, id & 0xff, 0, 0, ...u32(data.length),
    ...Array.from(data), ...(data.length & 1 ? [0] : [])];
}

/** A row of `width` 255s in PackBits: runs of up to 128 (header 257 − n),
 *  and a lone last byte as a one-byte literal (header 0). */
function opaqueRow(width: number): number[] {
  const out: number[] = [];
  for (let left = width; left > 0;) {
    const run = Math.min(left, 128);
    out.push(run === 1 ? 0 : 257 - run, 255);
    left -= run;
  }
  return out;
}
