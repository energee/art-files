// files.test.ts — Tauri native save/open dialogs and path reuse.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const open = vi.fn();
const writeFile = vi.fn();
const readFile = vi.fn();
const rename = vi.fn();
const remove = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save, open }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile, readFile, rename, remove }));
let tauri = false;
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri }));

import { openNativeFile, saveThrough } from "@/files";

describe("native file saving", () => {
  const options = {
    name: "Labradorite.label", type: "application/octet-stream",
    filter: { name: "Label project", extensions: ["label"] },
    types: [],
  };
  const download = vi.fn();
  beforeEach(() => {
    tauri = true;
    save.mockReset();
    writeFile.mockReset();
    rename.mockReset();
    remove.mockReset();
    download.mockReset();
  });
  afterEach(() => { tauri = false; });

  it("opens a native Save As dialog and writes its selected path", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    save.mockResolvedValue("/labels/Labradorite.label");

    await expect(saveThrough(bytes, options, download)).resolves.toEqual({
      name: "/labels/Labradorite.label", bytes, target: { path: "/labels/Labradorite.label" },
    });

    expect(save).toHaveBeenCalledWith({
      defaultPath: "Labradorite.label",
      filters: [{ name: "Label project", extensions: ["label"] }],
    });
    expect(writeFile).toHaveBeenCalledWith("/labels/Labradorite.saving.label", bytes);
    expect(rename).toHaveBeenCalledWith("/labels/Labradorite.saving.label", "/labels/Labradorite.label");
  });

  it("reuses an existing Save path without opening another dialog", async () => {
    const bytes = new Uint8Array([4, 5, 6]);

    await expect(saveThrough(bytes, { ...options, target: { path: "/labels/existing.label" } }, download))
      .resolves.toMatchObject({ name: "/labels/existing.label" });

    expect(save).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith("/labels/existing.saving.label", bytes);
    expect(rename).toHaveBeenCalledWith("/labels/existing.saving.label", "/labels/existing.label");
  });

  it("treats a cancelled dialog as no save", async () => {
    save.mockResolvedValue(null);

    await expect(saveThrough(new Uint8Array([7]), options, download)).resolves.toBeNull();

    expect(writeFile).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("propagates write failures instead of pretending the save completed", async () => {
    save.mockResolvedValue("/labels/unwritable.label");
    writeFile.mockRejectedValue(new Error("permission denied"));

    await expect(saveThrough(new Uint8Array([8]), options, download)).rejects.toThrow("permission denied");
    expect(download).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("never overwrites the original when the temp write fails, and cleans up the temp", async () => {
    writeFile.mockRejectedValue(new Error("disk full"));

    await expect(saveThrough(new Uint8Array([9]), { ...options, target: { path: "/m/Big.MASTER" } }, download))
      .rejects.toThrow("disk full");
    expect(writeFile).toHaveBeenCalledWith("/m/Big.saving.MASTER", expect.any(Uint8Array));
    expect(rename).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("/m/Big.saving.MASTER");
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

describe("browser saveThrough", () => {
  const options = {
    name: "label.pdf", type: "application/pdf",
    filter: { name: "PDF file", extensions: ["pdf"] },
    types: [{ description: "PDF file", accept: { "application/pdf": [".pdf"] } }],
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  // A long export build outlives Chrome's user-activation window, so the
  // picker throws SecurityError; the old saveVia downloaded instead.
  it("downloads when the picker refuses with a non-abort error", async () => {
    vi.stubGlobal("window", { showSaveFilePicker: vi.fn().mockRejectedValue(
      new DOMException("Must be handling a user gesture", "SecurityError")) });
    const download = vi.fn();
    const bytes = new Uint8Array([1]);
    await expect(saveThrough(bytes, options, download)).resolves.toEqual({ name: "label.pdf", bytes, target: undefined });
    expect(download).toHaveBeenCalledWith(bytes, "label.pdf", "application/pdf");
  });

  it("treats a dismissed picker as cancelled, with no download", async () => {
    vi.stubGlobal("window", { showSaveFilePicker: vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError")) });
    const download = vi.fn();
    await expect(saveThrough(new Uint8Array([1]), options, download)).resolves.toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
});
