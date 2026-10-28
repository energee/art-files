// @vitest-environment happy-dom
// export-pair-dialog-dom.test.tsx — on desktop, exporting the art + mask pair
// asks where at most once per tab: the first export's dialog opens beside the
// tab's .label, under its name; the mask is always written beside the art file
// as `<art stem>-mask.<ext>`, never with a dialog of its own; a repeat export
// rewrites both files with no dialog; Export … As… asks again.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const save = vi.fn();
const writeFile = vi.fn(async (_path: string, _bytes: Uint8Array) => undefined);
const exists = vi.fn(async () => true);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile, exists }));
// Real Poppins: the real builders run (vitest mocks of a module imported
// in parallel by Promise.all can resolve to the unmocked copy).
vi.mock("@/pdf/fonts", async () => ({ loadFonts: async () => (await import("./fixtures")).assets.fonts }));
vi.mock("@/planLayers", () => ({ planLayers: () => [] }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writes = () => writeFile.mock.calls.map(([p]) => p);

/** Mount one tab's useExport; `exportPdfs` runs Export PDFs (or, with `ask`,
 *  Export PDFs As…) in it and reports the header's note and error. */
async function mountExport() {
  const { useExport } = await import("@/useExport");
  const setBuildError = vi.fn();
  let api: ReturnType<typeof useExport> | undefined;
  function Probe() {
    api = useExport({
      drawLayers: [], family: "poppins", liveImages: {}, planAssets: () => ({}) as never,
      pageArt: () => ({}), title: "Beer", exportBase: "beer",
      render: { bleedIn: 0.125, dpi: 600 } as never, setBuildError,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  return {
    api: () => api!,
    async exportPdfs(options?: Parameters<NonNullable<typeof api>["buildFull"]>[0]) {
      setBuildError.mockClear();
      await act(async () => { await api!.buildFull(options); });
      return { note: api!.exportNote, error: setBuildError.mock.lastCall?.[0] as string | undefined };
    },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  save.mockReset();
  writeFile.mockClear();
  exists.mockClear();
});

it("writes the mask beside the chosen art file without a second dialog", async () => {
  save.mockResolvedValue("/labels/Renamed.pdf");
  const tab = await mountExport();
  const { note } = await tab.exportPdfs();
  expect(save).toHaveBeenCalledTimes(1);
  // No .label path yet: the dialog suggests the bare export name, as before.
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "beer.pdf" }));
  expect(writes()).toEqual(["/labels/Renamed.pdf", "/labels/Renamed-mask.pdf"]);
  expect(note).toBe("Saved /labels/Renamed.pdf, /labels/Renamed-mask.pdf.");
  tab.unmount();
}, 30000);

it("never asks about the mask, even when one is already there", async () => {
  save.mockResolvedValue("/labels/Renamed.pdf");
  const tab = await mountExport();
  await tab.exportPdfs();
  // The art dialog's confirmation covers the pair: no existence check, no
  // second dialog, the old mask is replaced.
  expect(exists).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
  expect(writes()).toContain("/labels/Renamed-mask.pdf");
  tab.unmount();
}, 30000);

it("opens the first export's dialog beside the tab's .label, under its name", async () => {
  save.mockResolvedValue("/labels/Lupula.pdf");
  const tab = await mountExport();
  await tab.exportPdfs({ labelPath: "/labels/Lupula.label" });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/labels/Lupula.pdf" }));
  tab.unmount();
}, 30000);

it("rewrites the remembered pair on a repeat export, with no dialog", async () => {
  save.mockResolvedValue("/out/Renamed.pdf");
  const tab = await mountExport();
  await tab.exportPdfs({ labelPath: "/labels/Lupula.label" });
  writeFile.mockClear();
  const { note } = await tab.exportPdfs({ labelPath: "/labels/Lupula.label" });
  expect(save).toHaveBeenCalledTimes(1);
  expect(writes()).toEqual(["/out/Renamed.pdf", "/out/Renamed-mask.pdf"]);
  expect(note).toBe("Saved /out/Renamed.pdf, /out/Renamed-mask.pdf.");
  tab.unmount();
}, 30000);

it("asks again for Export As…, opening on the remembered file, and remembers the new one", async () => {
  save.mockResolvedValueOnce("/out/Renamed.pdf").mockResolvedValueOnce("/elsewhere/Other.pdf");
  const tab = await mountExport();
  await tab.exportPdfs();
  writeFile.mockClear();
  await tab.exportPdfs({ ask: true });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/out/Renamed.pdf" }));
  expect(writes()).toEqual(["/elsewhere/Other.pdf", "/elsewhere/Other-mask.pdf"]);
  writeFile.mockClear();
  await tab.exportPdfs();
  expect(save).toHaveBeenCalledTimes(2);
  expect(writes()).toEqual(["/elsewhere/Other.pdf", "/elsewhere/Other-mask.pdf"]);
  tab.unmount();
}, 30000);

it("keeps the remembered file when Export As… is cancelled", async () => {
  save.mockResolvedValueOnce("/out/Renamed.pdf").mockResolvedValueOnce(null);
  const tab = await mountExport();
  await tab.exportPdfs();
  const { error } = await tab.exportPdfs({ ask: true });
  expect(error).toBe("Note: Export cancelled before saving /out/Renamed.pdf.");
  writeFile.mockClear();
  await tab.exportPdfs();
  expect(save).toHaveBeenCalledTimes(2);
  expect(writes()).toEqual(["/out/Renamed.pdf", "/out/Renamed-mask.pdf"]);
  tab.unmount();
}, 30000);

it("forgets the remembered file when the tab opens another document", async () => {
  save.mockResolvedValue("/out/Renamed.pdf");
  const tab = await mountExport();
  await tab.exportPdfs();
  act(() => tab.api().forgetExportPaths());
  await tab.exportPdfs({ labelPath: "/labels/Next.label" });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/labels/Next.pdf" }));
  tab.unmount();
}, 30000);

it("names the mask with the export's own extension, whatever the art file was called", async () => {
  save.mockResolvedValue("/labels/Renamed");
  const tab = await mountExport();
  await tab.exportPdfs();
  expect(save).toHaveBeenCalledTimes(1);
  expect(writes()).toEqual(["/labels/Renamed", "/labels/Renamed-mask.pdf"]);
  tab.unmount();
}, 30000);

it("names the derived mask path when writing it fails", async () => {
  save.mockResolvedValue("/labels/Renamed.pdf");
  writeFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("disk full"));
  const tab = await mountExport();
  const { error } = await tab.exportPdfs();
  expect(error).toBe("Saved /labels/Renamed.pdf. Could not save /labels/Renamed-mask.pdf: disk full");
  tab.unmount();
}, 30000);
