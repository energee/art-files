// files.test.ts — Tauri native save/open dialogs and path reuse.
import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const open = vi.fn();
const writeFile = vi.fn();
const readFile = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save, open }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile, readFile }));

import { openNativeFile, saveNativeFile } from "@/files";

describe("native file saving", () => {
  beforeEach(() => {
    save.mockReset();
    open.mockReset();
    writeFile.mockReset();
    readFile.mockReset();
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

describe("native file opening", () => {
  beforeEach(() => {
    open.mockReset();
  });

  it("opens a native Open dialog and returns the selected path", async () => {
    open.mockResolvedValue("/masters/Mine.master");
    await expect(openNativeFile({
      filter: { name: "Label master", extensions: ["master"] },
    })).resolves.toBe("/masters/Mine.master");
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "Label master", extensions: ["master"] }],
    });
  });

  it("treats a cancelled dialog as no open", async () => {
    open.mockResolvedValue(null);
    await expect(openNativeFile({
      filter: { name: "Label master", extensions: ["master"] },
    })).resolves.toBeNull();
  });
});
