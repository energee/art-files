// @vitest-environment happy-dom
// export-pair-dialog-dom.test.tsx — on desktop, exporting the art + mask pair
// asks where at most once per tab: the first export's dialog opens beside the
// tab's .label, under its name; the mask is always written beside the art file
// as `<art stem>-mask.<ext>`, never with a dialog of its own; a repeat export
// rewrites both files with no dialog; Export … As… asks again. What each export
// reports shows as a toast from the real <Toaster /> (tests/toast-harness.ts).
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notify } from "@/notify";
import { advance, mount, setupToastHarness, settleDismissal, show, text, toastCount } from "./toast-harness";

const save = vi.fn();
const writeFile = vi.fn(async (_path: string, _bytes: Uint8Array) => undefined);
const exists = vi.fn(async (_path: string) => true);
const revealItemInDir = vi.fn(async (_path: string) => undefined);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile, exists }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir }));
// Real Poppins: the real builders run (vitest mocks of a module imported
// in parallel by Promise.all can resolve to the unmocked copy).
vi.mock("@/pdf/fonts", async () => ({ loadFonts: async () => (await import("./fixtures")).assets.fonts }));
vi.mock("@/planLayers", () => ({ planLayers: () => [] }));

await import("@/pdf/build"); // before any test fakes the clock (tests/toast-harness.ts)
const { useExport } = await import("@/useExport");

setupToastHarness();

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

const writes = () => writeFile.mock.calls.map(([p]) => p);
const toastTitle = () => document.querySelector("[data-title]")?.textContent;
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

/** Mount one tab's useExport; `exportPdfs` runs Export PDFs (or, with `ask`,
 *  Export PDFs As…) in it, and `exportPrint` the one-file print PDF; each
 *  leaves the toast it raised on screen. */
async function mountExport() {
  let api: ReturnType<typeof useExport> | undefined;
  function Probe() {
    api = useExport({
      drawLayers: [], family: "poppins", liveImages: {}, planAssets: () => ({}) as never,
      pageArt: () => ({}), title: "Beer", exportBase: "beer",
      render: { bleedIn: 0.125, dpi: 600 } as never, exportAgain: () => undefined,
    });
    return null;
  }
  mount(<Probe />);
  return {
    api: () => api!,
    async exportPdfs(options?: Parameters<NonNullable<typeof api>["buildFull"]>[0]) {
      await act(async () => { await api!.buildFull(options, "pair"); });
      advance(0); // Sonner's deferred render of the toast
    },
    async exportPrint(options?: Parameters<NonNullable<typeof api>["buildFull"]>[0]) {
      await act(async () => {
        await api!.buildFull(options);
        // The stale-mask check runs after the export; let it land.
        await new Promise((resolve) => setImmediate(resolve));
      });
      advance(0);
    },
  };
}

beforeEach(() => {
  save.mockReset();
  writeFile.mockClear();
  exists.mockReset(); // back to the vi.fn default: every path exists
  revealItemInDir.mockClear();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC);
});
afterEach(() => { vi.restoreAllMocks(); });

it("writes the mask beside the chosen art file without a second dialog", async () => {
  save.mockResolvedValue("/labels/Renamed.pdf");
  const tab = await mountExport();
  await tab.exportPdfs();
  expect(save).toHaveBeenCalledTimes(1);
  // No .label path yet: the dialog suggests the bare export name, as before.
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "beer.pdf" }));
  expect(writes()).toEqual(["/labels/Renamed.pdf", "/labels/Renamed-mask.pdf"]);
  // The toast names the files; Show in Finder keeps the full path.
  expect(toastTitle()).toBe("Saved Renamed.pdf, Renamed-mask.pdf");
  await act(async () => { button("Show in Finder")!.click(); });
  expect(revealItemInDir).toHaveBeenCalledWith("/labels/Renamed.pdf");
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
}, 30000);

it("opens the first export's dialog beside the tab's .label, under its name", async () => {
  save.mockResolvedValue("/labels/Lupula.pdf");
  const tab = await mountExport();
  await tab.exportPdfs({ labelPath: "/labels/Lupula.label" });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/labels/Lupula.pdf" }));
}, 30000);

it("rewrites the remembered pair on a repeat export, with no dialog", async () => {
  save.mockResolvedValue("/out/Renamed.pdf");
  const tab = await mountExport();
  await tab.exportPdfs({ labelPath: "/labels/Lupula.label" });
  writeFile.mockClear();
  await tab.exportPdfs({ labelPath: "/labels/Lupula.label" });
  expect(save).toHaveBeenCalledTimes(1);
  expect(writes()).toEqual(["/out/Renamed.pdf", "/out/Renamed-mask.pdf"]);
  expect(toastTitle()).toBe("Saved Renamed.pdf, Renamed-mask.pdf");
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
}, 30000);

it("keeps the remembered file when Export As… is cancelled", async () => {
  save.mockResolvedValueOnce("/out/Renamed.pdf").mockResolvedValueOnce(null);
  const tab = await mountExport();
  await tab.exportPdfs();
  await tab.exportPdfs({ ask: true });
  // The cancel says nothing, and the new export retired the earlier "Saved …".
  settleDismissal();
  expect(toastCount()).toBe(0);
  writeFile.mockClear();
  await tab.exportPdfs();
  expect(save).toHaveBeenCalledTimes(2);
  expect(writes()).toEqual(["/out/Renamed.pdf", "/out/Renamed-mask.pdf"]);
}, 30000);

it("forgets the remembered file when the tab opens another document", async () => {
  save.mockResolvedValue("/out/Renamed.pdf");
  const tab = await mountExport();
  await tab.exportPdfs();
  act(() => tab.api().forgetExportPaths());
  await tab.exportPdfs({ labelPath: "/labels/Next.label" });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/labels/Next.pdf" }));
}, 30000);

it("asks again once the label's own path changes (Save Label As), never rewriting the old beer's PDFs", async () => {
  save.mockResolvedValueOnce("/print/Lupula.pdf").mockResolvedValueOnce("/print/Haze.pdf");
  const tab = await mountExport();
  await tab.exportPdfs({ labelPath: "/labels/Lupula.label" });
  writeFile.mockClear();
  // Same tab, same document — but saved under a new name.
  await tab.exportPdfs({ labelPath: "/labels/Haze.label" });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/labels/Haze.pdf" }));
  expect(writes()).toEqual(["/print/Haze.pdf", "/print/Haze-mask.pdf"]);
}, 30000);

it("names the mask with the export's own extension, whatever the art file was called", async () => {
  save.mockResolvedValue("/labels/Renamed");
  const tab = await mountExport();
  await tab.exportPdfs();
  expect(save).toHaveBeenCalledTimes(1);
  expect(writes()).toEqual(["/labels/Renamed", "/labels/Renamed-mask.pdf"]);
}, 30000);

it("names the derived mask path when writing it fails", async () => {
  save.mockResolvedValue("/labels/Renamed.pdf");
  writeFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("disk full"));
  const tab = await mountExport();
  await tab.exportPdfs();
  expect(toastTitle()).toBe("Couldn't save Renamed-mask.pdf");
  expect(text()).toContain("Saved Renamed.pdf. disk full");
}, 30000);

it("remembers a single print file, keeps its destination on cancelled As, and separates pair memory", async () => {
  save.mockResolvedValueOnce("/print/Beer.pdf")
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("/legacy/Beer.pdf")
    .mockResolvedValueOnce("/new/New.pdf");
  exists.mockImplementation(async () => false);
  const tab = await mountExport();
  const labelPath = "/labels/Beer.label";
  await tab.exportPrint({ labelPath });
  expect(toastTitle()).toBe("Saved Beer.pdf");
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("success");
  expect(writes()).toEqual(["/print/Beer.pdf"]);
  writeFile.mockClear();
  await tab.exportPrint({ labelPath });
  expect(save).toHaveBeenCalledTimes(1);
  expect(writes()).toEqual(["/print/Beer.pdf"]);
  await tab.exportPrint({ labelPath, ask: true });
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/print/Beer.pdf" }));
  writeFile.mockClear();
  await tab.exportPrint({ labelPath });
  expect(writes()).toEqual(["/print/Beer.pdf"]);
  await tab.exportPdfs({ labelPath });
  expect(save).toHaveBeenCalledTimes(3);
  writeFile.mockClear();
  await tab.exportPrint({ labelPath });
  expect(writes()).toEqual(["/print/Beer.pdf"]);
  await tab.exportPrint({ labelPath: "/labels/New.label" });
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/labels/New.pdf" }));
  expect(writes()).toEqual(["/print/Beer.pdf", "/new/New.pdf"]);
}, 30_000);

// The print PDF carries the white ink itself; an older pair's mask left beside
// it could be sent to the printer as a second plate, so the saved toast becomes
// a warning that offers to reveal the old mask. It is the export's own toast:
// another source's toast survives it, and an edit does not clear it.
it("an older -mask.pdf beside the print PDF warns and offers to reveal it", async () => {
  save.mockResolvedValueOnce("/print/Beer.pdf");
  exists.mockImplementation(async (path) => path === "/print/Beer-mask.pdf");
  const tab = await mountExport();
  show(() => notify.error("Could not load image: bad.png", { id: "image" }));
  await tab.exportPrint();

  // One toast for the export: the warning replaced the "Saved …" confirmation.
  const warning = [...document.querySelectorAll("[data-sonner-toast]")].find((li) => li.textContent?.includes("Saved"))!;
  expect(warning.getAttribute("data-type")).toBe("warning");
  expect(warning.querySelector("[data-title]")!.textContent).toBe("Saved Beer.pdf");
  expect(warning.querySelector("[data-description]")!.textContent).toBe(
    "Don't send the old Beer-mask.pdf with it. This PDF already has the white ink.");
  expect(toastCount()).toBe(2);
  expect(writes()).toEqual(["/print/Beer.pdf"]);

  // An edit leaves it up, and so does time: it stays until closed.
  act(() => tab.api().exportStale());
  advance(60_000);
  expect(text()).toContain("Don't send the old");
  expect(text()).toContain("Could not load image: bad.png");

  await act(async () => { [...warning.querySelectorAll("button")].find((b) => b.textContent === "Show in Finder")!.click(); });
  expect(revealItemInDir).toHaveBeenCalledWith("/print/Beer-mask.pdf");
}, 30_000);

it("no warning when no older -mask.pdf sits beside the print PDF", async () => {
  save.mockResolvedValueOnce("/print/Beer.pdf");
  exists.mockImplementation(async () => false);
  const tab = await mountExport();
  await tab.exportPrint();
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("success");
  expect(text()).not.toContain("Don't send the old");
  await act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent === "Show in Finder")!.click(); });
  expect(revealItemInDir).toHaveBeenCalledWith("/print/Beer.pdf");
}, 30_000);

// The old -mask.pdf is stale whatever was edited, so its warning is not held back
// by an edit the way the Saved confirmation is (#400).
it("an edit during the export withholds Saved but still warns about an older -mask.pdf", async () => {
  let choose!: (path: string) => void;
  save.mockReturnValueOnce(new Promise<string>((resolve) => { choose = resolve; }));
  exists.mockImplementation(async (path) => path === "/print/Beer-mask.pdf");
  const tab = await mountExport();
  let running!: Promise<void>;
  await act(async () => {
    running = tab.api().buildFull();
    while (save.mock.calls.length < 1) await new Promise((resolve) => setImmediate(resolve));
  });
  act(() => tab.api().exportStale()); // the label was edited mid-export
  await act(async () => {
    choose("/print/Beer.pdf");
    await running;
    await new Promise((resolve) => setImmediate(resolve)); // the stale-mask check
  });
  advance(0);

  expect(toastCount()).toBe(1);
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("warning");
  expect(toastTitle()).toBe("Saved Beer.pdf");
  expect(text()).toContain("Don't send the old Beer-mask.pdf");
}, 30_000);
