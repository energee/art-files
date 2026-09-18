// export-pair.test.ts — the artwork-then-mask export sequencing.
import { describe, expect, it } from "vitest";
import { savePair } from "../src/exportPair";

const a = new Uint8Array([1]), m = new Uint8Array([2]);
const fake = (answers: boolean[]) => {
  const calls: { name: string; title?: string }[] = [];
  const save = async (_b: Uint8Array, name: string, title?: string) => { calls.push({ name, title }); return answers.shift() ?? true; };
  return { save, calls };
};

describe("savePair", () => {
  it("titles the two dialogs and saves both", async () => {
    const { save, calls } = fake([true, true]);
    expect(await savePair(save, a, m, "Lager", "pdf", "PDF")).toBe("saved");
    expect(calls).toEqual([
      { name: "Lager.pdf", title: "Export 1 of 2: Artwork PDF" },
      { name: "Lager-mask.pdf", title: "Export 2 of 2: Mask PDF" },
    ]);
  });
  it("a cancel on the first dialog skips the second", async () => {
    const { save, calls } = fake([false]);
    expect(await savePair(save, a, m, "Lager", "pdf", "PDF")).toBe("cancelled");
    expect(calls).toHaveLength(1);
  });
  it("a cancel on the second dialog is partial — the artwork is on disk", async () => {
    expect(await savePair(fake([true, false]).save, a, m, "Lager", "psd", "PSD")).toBe("partial");
  });
  it("a single plate has no title and cancels cleanly", async () => {
    const { save, calls } = fake([false]);
    expect(await savePair(save, null, m, "Lager", "pdf", "PDF")).toBe("cancelled");
    expect(calls).toEqual([{ name: "Lager-mask.pdf", title: undefined }]);
  });
});
