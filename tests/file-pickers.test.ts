// file-pickers.test.ts — the one Uint8Array → BlobPart cast (#417): Blob,
// File and FileSystemWritableFileStream writes all go through bytesPart.
import { expect, it } from "vitest";
import { bytesPart, writeHandle } from "@/filePickers";

const bytes = new Uint8Array([0, 1, 2, 254, 255]);

it("bytesPart keeps the bytes a Blob or File is built from", async () => {
  expect(new Uint8Array(await new Blob([bytesPart(bytes)]).arrayBuffer())).toEqual(bytes);
  const file = new File([bytesPart(bytes)], "a.png", { type: "image/png" });
  expect(file.type).toBe("image/png");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
});

it("writeHandle writes the bytes themselves, not a Blob", async () => {
  const writes: unknown[] = [];
  const handle = {
    createWritable: async () => ({ write: async (b: unknown) => { writes.push(b); }, close: async () => {} }),
  } as unknown as FileSystemFileHandle;
  await writeHandle(handle, bytes);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toBe(bytes);
});
