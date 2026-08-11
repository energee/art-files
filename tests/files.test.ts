// files.test.ts — Tauri native save dialog and path reuse.
import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const writeFile = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile }));

import { saveNativeFile } from "@/files";

describe("native file saving", () => {
  beforeEach(() => {
    save.mockReset();
    writeFile.mockReset();
  });

  it("opens a native Save As dialog and writes its selected path", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    save.mockResolvedValue("/labels/Labradorite.label");

    await expect(saveNativeFile(bytes, {
      defaultPath: "Labradorite.label",
      filter: { name: "Label project", extensions: ["label"] },
    })).resolves.toBe("/labels/Labradorite.label");

    expect(save).toHaveBeenCalledWith({
      defaultPath: "Labradorite.label",
      filters: [{ name: "Label project", extensions: ["label"] }],
    });
    expect(writeFile).toHaveBeenCalledWith("/labels/Labradorite.label", bytes);
  });

  it("reuses an existing Save path without opening another dialog", async () => {
    const bytes = new Uint8Array([4, 5, 6]);

    await expect(saveNativeFile(bytes, {
      defaultPath: "ignored.label",
      filter: { name: "Label project", extensions: ["label"] },
      path: "/labels/existing.label",
    })).resolves.toBe("/labels/existing.label");

    expect(save).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith("/labels/existing.label", bytes);
  });

  it("treats a cancelled dialog as no save", async () => {
    save.mockResolvedValue(null);

    await expect(saveNativeFile(new Uint8Array([7]), {
      defaultPath: "cancel.label",
      filter: { name: "Label project", extensions: ["label"] },
    })).resolves.toBeNull();

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("propagates write failures instead of pretending the save completed", async () => {
    save.mockResolvedValue("/labels/unwritable.label");
    writeFile.mockRejectedValue(new Error("permission denied"));

    await expect(saveNativeFile(new Uint8Array([8]), {
      defaultPath: "unwritable.label",
      filter: { name: "Label project", extensions: ["label"] },
    })).rejects.toThrow("permission denied");
  });
});
