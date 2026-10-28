// psd-spot-channel.test.ts — addWhiteInkChannel splices a "White Ink" spot
// channel into a finished ag-psd file: an opaque transparency channel (so
// readers that take a 4th channel as alpha, like macOS's, still show the
// art), then the ink bytes, named in Alpha Names (1006) and marked spot at
// 0% solidity in DisplayInfo (1077), with the composite and layers intact.
import { describe, expect, it } from "vitest";
import { readPsd, writePsdUint8Array } from "ag-psd";
import { addWhiteInkChannel } from "../src/psd/spotChannel";
import { WHITE_INK } from "../src/layout";

/** The bits of a PSD this test checks, read straight from the bytes. */
function parse(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = v.getUint16(12), height = v.getUint32(14), width = v.getUint32(18);
  let o = 26;
  o += 4 + v.getUint32(o); // color mode data
  const resources = new Map<number, Uint8Array>();
  const resEnd = o + 4 + v.getUint32(o);
  for (o += 4; o < resEnd;) {
    const id = v.getUint16(o + 4);
    const nameLen = bytes[o + 6];
    o += 6 + ((nameLen + 2) & ~1);
    const size = v.getUint32(o);
    resources.set(id, bytes.subarray(o + 4, o + 4 + size));
    o += 4 + size + (size & 1);
  }
  o = resEnd;
  const layerCount = v.getInt16(o + 8); // after the section and layer-info lengths
  o += 4 + v.getUint32(o); // layer and mask info
  expect(v.getUint16(o)).toBe(1); // RLE
  const counts: number[] = [];
  for (let i = 0, p = o + 2; i < channels * height; i++, p += 2) counts.push(v.getUint16(p));
  let p = o + 2 + 2 * channels * height;
  const planes = Array.from({ length: channels }, () => new Uint8Array(width * height));
  for (let c = 0; c < channels; c++) for (let y = 0; y < height; y++) {
    const end = p + counts[c * height + y];
    let x = y * width;
    while (p < end) {
      const n = bytes[p++];
      if (n < 128) for (let k = 0; k <= n; k++) planes[c][x++] = bytes[p++];
      else if (n > 128) { const value = bytes[p++]; for (let k = 0; k < 257 - n; k++) planes[c][x++] = value; }
    }
    expect(x).toBe((y + 1) * width);
  }
  return { channels, width, height, resources, planes, layerCount };
}

describe("addWhiteInkChannel", () => {
  const width = 300, height = 3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([i % 251, 40, 200, 255], i);
  const psd = writePsdUint8Array({
    width, height, imageData: { data: rgba, width, height } as ImageData,
    children: [{ name: "Art", left: 0, top: 0, right: 0, bottom: 0 }],
  });
  // Long runs (packed) and a stretch of distinct bytes (literal), per row.
  const ink = new Uint8Array(width * height).map((_, i) => (i % width < 150 ? 0 : i % width < 200 ? i % 7 : 255));

  it("adds an opaque transparency channel, then the ink, and keeps the RGB composite", () => {
    const before = parse(psd);
    const after = parse(addWhiteInkChannel(psd, ink));
    expect(before.channels).toBe(3);
    expect(after.channels).toBe(5);
    expect(after.planes.slice(0, 3)).toEqual(before.planes);
    expect(after.planes[3].every((a) => a === 255)).toBe(true);
    expect(after.planes[4]).toEqual(ink);
    // A negative count tells Photoshop the 4th channel is the transparency.
    expect(before.layerCount).toBe(1);
    expect(after.layerCount).toBe(-1);
  });

  // Photoshop's own save of such a file lists the transparency first in the
  // channel names (1006, 1045) and DisplayInfo (1077), then White Ink.
  it("names Transparency and White Ink, and marks White Ink spot at 0% solidity", () => {
    const { resources } = parse(addWhiteInkChannel(psd, ink));
    const names = resources.get(1006)!;
    const pascal: string[] = [];
    for (let o = 0; o < names.length; o += 1 + names[o])
      pascal.push(new TextDecoder().decode(names.subarray(o + 1, o + 1 + names[o])));
    expect(pascal).toEqual(["Transparency", WHITE_INK]);
    const info = new DataView(resources.get(1077)!.buffer, resources.get(1077)!.byteOffset);
    expect(resources.get(1077)!.length).toBe(4 + 2 * 13);
    expect(info.getUint32(0)).toBe(1); // version
    expect(info.getUint8(16)).toBe(1); // transparency: an ordinary channel
    expect(info.getUint16(4 + 13 + 10)).toBe(0); // White Ink solidity 0%
    expect(info.getUint8(4 + 13 + 12)).toBe(2); // White Ink kind: spot
  });

  it("leaves a file ag-psd still reads, layers and all", () => {
    const read = readPsd(addWhiteInkChannel(psd, ink).slice().buffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
    expect(read.children?.map((l) => l.name)).toEqual(["Art"]);
    expect(read.imageResources?.alphaChannelNames).toEqual(["Transparency", WHITE_INK]);
  });

  it("refuses ink that is not one byte per pixel", () => {
    expect(() => addWhiteInkChannel(psd, new Uint8Array(5))).toThrow(/one byte per pixel/);
  });
});
