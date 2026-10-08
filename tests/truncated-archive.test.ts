// truncated-archive.test.ts — #391: a .label cut off mid-write must not open
// as if it were whole. unpackArchive keeps an entry only once its last chunk
// arrives, so a truncated texture would otherwise vanish without an error.
import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { unpackArchive } from "../src/labelfile";

it("rejects an archive truncated partway through an asset", () => {
  const texture = new Uint8Array(400_000).map((_, i) => (i * 2654435761) >>> 24);
  const bytes = zipSync({
    "label.json": new TextEncoder().encode("{}"),
    "texture/art.png": [texture, { level: 0 }],
  });
  expect(() => unpackArchive(bytes.subarray(0, 200_000))).toThrow();
});
