// @vitest-environment happy-dom
// export-geometry-race-dom.test.tsx — Bleed and PSD resolution are module state
// in layout.ts, and Settings stays reachable while an export runs, so the
// geometry can move at any await of a build (#688). An export runs at the
// geometry it started with: each test here moves the live layout at one of
// those awaits, and the file must equal a calm export of the start geometry.
// A hidden tab's Export again starts from the live layout, not from the render
// prop its memo froze (#691). The real builders run; only the dialog, the font
// loaders and the image decode are faked.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PDFDocument, PDFImage } from "pdf-lib";
import { readPsd } from "ag-psd";
import * as L from "../src/layout";
import { PAGE_ART_ID, type Layer } from "../src/model/layers";
import { notify } from "../src/notify";

const race = vi.hoisted(() => ({
  /** Where this test moves the geometry: a hook name below. */
  at: "",
  /** Moves the live layout, as a Settings change does when App renders. */
  move: () => {},
  fire(hook: string) { if (race.at === hook) { race.at = ""; race.move(); } },
  saved: [] as Uint8Array[],
  planned: [] as { pageW: number; shift: number; canvasW: number }[],
  /** The geometry each PSD job carried to its worker. */
  jobs: [] as { bleedIn: number; dpi: number }[],
}));
vi.mock("../src/files", () => ({
  saveThrough: async (bytes: Uint8Array, options: { name: string }) => {
    race.saved.push(bytes);
    return { name: options.name, bytes };
  },
  nativeExists: async () => false,
}));
vi.mock("../src/fonts", () => ({
  FONT_URLS: { poppins: {} },
  labelFontCss: () => "sans-serif",
  loadLabelFaces: async () => { race.fire("faces"); },
  loadFonts: async () => { race.fire("fonts"); return (await import("./fixtures")).assets.fonts; },
}));
vi.mock("../src/canvas/draw", () => ({
  drawPlate: (ctx: CanvasRenderingContext2D) => {
    race.planned.push({ pageW: L.PAGE.w, shift: L.BLEED_SHIFT, canvasW: ctx.canvas.width });
  },
}));
vi.mock("../src/assets/io", async (real) => ({
  ...await real<typeof import("../src/assets/io")>(),
  rasterPixelsNatural: async () => {
    race.fire("decode");
    return { data: new Uint8Array([0, 0, 0, 255]), width: 1, height: 1 };
  },
}));

vi.mock("../src/psd/offThread", async (real) => {
  const actual = await real<typeof import("../src/psd/offThread")>();
  return {
    ...actual,
    buildPsdOffThread: (job: Parameters<typeof actual.buildPsdOffThread>[0]) => {
      race.jobs.push(job.geometry);
      return actual.buildPsdOffThread(job);
    },
  };
});

const { useExport } = await import("../src/useExport");
const { laurelCustom, lolevLayers, onePxPng } = await import("./fixtures");

/** An opaque 1x1 art image, so a build embeds it and its footprint is awaited. */
const STYLE = lolevLayers()[0].style;
const ART_LAYER = {
  id: "art", name: "art", kind: "image", enabled: true, x: 100, anchor: "left", y: 100, asset: "art",
  style: STYLE, w: 50, h: 50,
} as unknown as Layer;
const LAYERS = [...lolevLayers(), ART_LAYER];

const START = { bleedIn: 0.0635, dpi: 72 };
const MOVED = { bleedIn: 0.25, dpi: 36 };
const setLive = (g: typeof START) => { L.setBleed(g.bleedIn); L.setOutputDpi(g.dpi); };

let api: ReturnType<typeof useExport>;
function Probe() {
  api = useExport({
    drawLayers: LAYERS, family: "poppins",
    liveImages: { art: { image: { kind: "png", bytes: onePxPng }, name: "art.png", previewUrl: "", aspect: 1 } },
    planAssets: () => ({ custom: {
      ...laurelCustom, art: { aspect: 1 },
      [PAGE_ART_ID.background]: { aspect: 1.5 }, [PAGE_ART_ID.mask]: { aspect: 1.5 },
    } }),
    pageArt: () => ({ texture: { bytes: onePxPng, kind: "png" }, maskPng: onePxPng }),
    title: "T", exportBase: "Lupula", exportAgain: () => {},
  });
  return null;
}

let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  race.at = "";
  race.saved = [];
  race.planned = [];
  race.jobs = [];
  race.move = () => setLive(MOVED);
  vi.stubGlobal("createImageBitmap", async () => { race.fire("bitmap"); return { close() {} }; });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this, resetTransform() {}, clearRect() {},
      getImageData: (_x: number, _y: number, width: number, height: number) =>
        ({ data: new Uint8ClampedArray(width * height * 4).fill(255), width, height }),
    } as never;
  });
  const embedPng = PDFDocument.prototype.embedPng;
  vi.spyOn(PDFDocument.prototype, "embedPng").mockImplementation(function (this: PDFDocument, png) {
    race.fire("embed");
    return embedPng.call(this, png);
  });
  const embed = PDFImage.prototype.embed;
  vi.spyOn(PDFImage.prototype, "embed").mockImplementation(function (this: PDFImage) {
    race.fire("footprint");
    return embed.call(this);
  });
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  L.setBleed(L.SHIPPED_BLEED_IN);
  L.setOutputDpi(L.DESIGN_DPI);
});

/** Everything `run` saved, starting at START with the race armed at `at`. */
async function exported(run: () => Promise<void>, at = "") {
  setLive(START);
  race.at = at;
  race.saved = [];
  const failed = vi.spyOn(notify, "error");
  await act(async () => { await run(); });
  expect(failed.mock.calls).toEqual([]);
  expect(race.at).toBe(""); // the hook fired: this interleaving really ran
  return race.saved;
}

const PDFS: [string, () => Promise<void>, string[]][] = [
  ["print PDF", () => api.buildFull(), ["fonts", "decode", "embed", "footprint"]],
  ["PDF pair", () => api.buildFull({}, "pair"), ["fonts", "embed", "footprint"]],
  ["art plate", () => api.exportPdfPlate("art"), ["fonts", "embed"]],
  ["mask plate", () => api.exportPdfPlate("mask"), ["fonts", "embed", "footprint"]],
];
const cases = PDFS.flatMap(([name, run, hooks]) => hooks.map((at) => [name, at, run] as const));

it.each(cases)("%s: geometry moved at %s saves what a calm export saves (#688)", async (_name, at, run) => {
  const calm = await exported(run);
  const raced = await exported(run, at);
  expect(raced.map((bytes, i) => Buffer.from(bytes).equals(Buffer.from(calm[i])))).toEqual(calm.map(() => true));
  expect(L.PAGE.w).toBe(L.TRIM.w + 2 * MOVED.bleedIn * 72); // the preview keeps the live geometry
}, 30_000);

const psdSize = (bytes: Uint8Array) => {
  const psd = readPsd(Buffer.from(bytes).buffer as ArrayBuffer,
    { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
  return [psd.width, psd.height];
};
const startDoc = [
  Math.round(((L.TRIM.w + 2 * START.bleedIn * 72) / 72) * START.dpi),
  Math.round(((L.TRIM.h + 2 * START.bleedIn * 72) / 72) * START.dpi),
];

it.each(["fonts", "bitmap", "faces"])("print PSD: geometry moved at %s saves what a calm export saves", async (at) => {
  const run = () => api.exportPsd();
  const [calm] = await exported(run);
  const [raced] = await exported(run, at);
  expect(psdSize(raced)).toEqual(startDoc);
  expect(Buffer.from(raced).equals(Buffer.from(calm))).toBe(true);
}, 30_000);

it("a PSD pair's plates flatten at the geometry the export started with", async () => {
  await exported(() => api.exportPsd({}, "pair"), "bitmap");
  const page = L.TRIM.w + 2 * START.bleedIn * 72;
  expect(race.planned.map((p) => p.pageW)).toEqual([page, page]);
  expect(race.planned[0].canvasW).toBe(startDoc[0]);
  expect(race.saved.map(psdSize)).toEqual([startDoc, startDoc]);
}, 30_000);

// A hidden tab's render prop is frozen (App's memo ignores it while hidden),
// so the job's geometry comes from the live layout Settings moved.
it("a PSD started from a hidden tab carries the live geometry to its worker (#691)", async () => {
  const [bytes] = await exported(() => api.exportPsd());
  expect(race.jobs).toEqual([START]);
  expect(psdSize(bytes)).toEqual(startDoc);
}, 30_000);

it("a geometry change during an export withholds Saved, like an edit (#400)", async () => {
  const success = vi.spyOn(notify, "success");
  await exported(() => api.buildFull(), "fonts");
  expect(success).not.toHaveBeenCalled();
  await exported(() => api.buildFull());
  expect(success).toHaveBeenCalledOnce();
}, 30_000);
