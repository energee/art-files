// @vitest-environment happy-dom
// export-pair-dialog-dom.test.tsx — on desktop, exporting the art + mask pair
// asks where once: the mask is written beside the art file the dialog chose,
// named `<art stem>-mask.<ext>`. An existing file at that path is not
// overwritten silently (the art dialog only confirmed the art file), so the
// mask's own dialog opens instead.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const written = (path: string) => writeFile.mock.calls.some(([p]) => p === path);

const save = vi.fn();
const writeFile = vi.fn(async (_path: string, _bytes: Uint8Array) => undefined);
const exists = vi.fn(async () => false);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile, exists }));
// Real Poppins: the real builders run (vitest mocks of a module imported
// in parallel by Promise.all can resolve to the unmocked copy).
vi.mock("@/pdf/fonts", async () => ({ loadFonts: async () => (await import("./fixtures")).assets.fonts }));
vi.mock("@/planLayers", () => ({ planLayers: () => [] }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function exportBoth() {
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
  await act(async () => { await api!.buildFull("both"); });

  const note = api!.exportNote;

  act(() => root.unmount());
  return { setBuildError, note };
}

beforeEach(() => {
  save.mockReset();
  writeFile.mockClear();
  exists.mockReset();
  exists.mockResolvedValue(false);
});

it("writes the mask beside the chosen art file without a second dialog", async () => {
  save.mockResolvedValue("/labels/Renamed.pdf");
  const { note } = await exportBoth();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "beer.pdf" }));
  expect(exists).toHaveBeenCalledWith("/labels/Renamed-mask.pdf");
  expect(writeFile.mock.calls.map(([p]) => p)).toEqual(["/labels/Renamed.pdf", "/labels/Renamed-mask.pdf"]);
  expect(note).toBe("Saved /labels/Renamed.pdf, /labels/Renamed-mask.pdf.");
}, 30000);

it("asks for the mask when a file already sits at the derived path", async () => {
  exists.mockResolvedValue(true);
  save.mockResolvedValueOnce("/labels/beer.pdf").mockResolvedValueOnce("/labels/other-mask.pdf");
  await exportBoth();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "beer-mask.pdf" }));
  expect(written("/labels/other-mask.pdf")).toBe(true);
  expect(written("/labels/beer-mask.pdf")).toBe(false);
}, 30000);

it("names the mask with the export's own extension, whatever the art file was called", async () => {
  save.mockResolvedValue("/labels/Renamed");
  await exportBoth();
  expect(save).toHaveBeenCalledTimes(1);
  expect(writeFile.mock.calls.map(([p]) => p)).toEqual(["/labels/Renamed", "/labels/Renamed-mask.pdf"]);
}, 30000);

it("asks for the mask when it cannot tell whether the derived path is free", async () => {
  exists.mockRejectedValue(new Error("forbidden"));
  save.mockResolvedValueOnce("/labels/beer.pdf").mockResolvedValueOnce("/labels/beer-mask.pdf");
  await exportBoth();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "beer-mask.pdf" }));
}, 30000);
