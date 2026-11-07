// @vitest-environment happy-dom
// export-cost-dom.test.tsx — what one export costs, as counts: font parses
// (#736), and for a print PSD the image decodes and the pixels its job copies
// rather than transfers (#723). The real builders run; only the dialog, the
// font loader and the canvas are faked.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import * as L from "../src/layout";
import { PAGE_ART_ID, type Layer } from "../src/model/layers";
import { notify } from "../src/notify";

const cost = vi.hoisted(() => ({
  fontsLoaded: [] as string[],
  psdJobs: [] as { job: import("../src/psd/offThread").PsdJob; transfer?: ArrayBuffer[] }[],
}));
vi.mock("../src/files", () => ({
  saveThrough: async (bytes: Uint8Array, options: { name: string }) => ({ name: options.name, bytes }),
  nativeExists: async () => false,
}));
vi.mock("../src/fonts", () => ({
  labelFontCss: () => "sans-serif",
  loadLabelFaces: async () => {},
  loadFonts: async (id: string) => {
    cost.fontsLoaded.push(id);
    return (await import("./fixtures")).assets.fonts;
  },
}));

vi.mock("../src/canvas/draw", () => ({ drawPlate: () => {} }));
vi.mock("../src/psd/offThread", async (real) => {
  const actual = await real<typeof import("../src/psd/offThread")>();
  return {
    ...actual,
    buildPsdOffThread: (...args: Parameters<typeof actual.buildPsdOffThread>) => {
      cost.psdJobs.push({ job: args[0], transfer: args[1] });
      return actual.buildPsdOffThread(...args);
    },
  };
});

const { useExport } = await import("../src/useExport");
const { laurelCustom, lolevLayers, onePxPng } = await import("./fixtures");

let pageArt: ReturnType<Parameters<typeof useExport>[0]["pageArt"]> = {};
let api: ReturnType<typeof useExport>;
function Probe({ layers }: { layers: Layer[] }) {
  api = useExport({
    drawLayers: layers, family: "poppins", liveImages: {},
    planAssets: () => ({ custom: {
      ...laurelCustom, [PAGE_ART_ID.background]: { aspect: 1.5 }, [PAGE_ART_ID.mask]: { aspect: 1.5 },
    } }),
    pageArt: () => pageArt,
    title: "T", exportBase: "Lupula", exportAgain: () => {},
  });
  return null;
}

let root: ReturnType<typeof createRoot>;
const mount = (layers: Layer[]) => act(async () => { root.render(createElement(Probe, { layers })); });
beforeEach(() => {
  cost.fontsLoaded = [];
  cost.psdJobs = [];
  pageArt = {};
  L.setOutputDpi(36); // a small document: these tests count, they don't look
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  L.setOutputDpi(L.DESIGN_DPI);
});

/** Each decode of an image: a 20x10 bitmap, whatever the bytes hold. */
function stubDecodes() {
  const decodes = vi.fn(async () => ({ width: 20, height: 10, close() {} }));
  vi.stubGlobal("createImageBitmap", decodes);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this, resetTransform() {}, clearRect() {}, drawImage() {},
      getImageData: (_x: number, _y: number, width: number, height: number) =>
        ({ data: new Uint8ClampedArray(width * height * 4).fill(255), width, height }),
    } as never;
  });
  return decodes;
}

async function exported(run: () => Promise<void>) {
  const failed = vi.spyOn(notify, "error");
  await act(async () => { await run(); });
  expect(failed.mock.calls).toEqual([]);
}

it("parses only the families the label uses (#736)", async () => {
  const parses = vi.spyOn(fontkit, "create");
  await mount(lolevLayers());
  await exported(() => api.buildFull({}, "pair"));
  expect(new Set(cost.fontsLoaded)).toEqual(new Set(["poppins"]));
  // Three faces each: the plan's measure, the art plate, the mask plate.
  expect(parses).toHaveBeenCalledTimes(9);
}, 30_000);

it("still measures a family only one layer picks (#736)", async () => {
  const layers = lolevLayers();
  const text = layers.find((l) => l.kind === "text")!;
  await mount(layers.map((l) => l === text ? { ...l, fontFamily: "barlow-condensed" } as Layer : l));
  await exported(() => api.buildFull({}, "pair"));
  expect(new Set(cost.fontsLoaded)).toEqual(new Set(["poppins", "barlow-condensed"]));
}, 30_000);

it("decodes each image once for a print PSD, at its natural size (#723, #88)", async () => {
  const decodes = stubDecodes();
  pageArt = { texture: { bytes: onePxPng, kind: "png" }, maskPng: onePxPng };
  await mount(lolevLayers());
  await exported(() => api.exportPsd());
  expect(decodes).toHaveBeenCalledTimes(2); // the texture and the mask
  const { images } = cost.psdJobs[0].job.assets;
  expect([images![PAGE_ART_ID.background]!.width, images![PAGE_ART_ID.mask]!.height]).toEqual([20, 10]);
}, 30_000);

it("transfers a print PSD's pixels and plates, and never the cached fonts (#723)", async () => {
  stubDecodes();
  pageArt = { texture: { bytes: onePxPng, kind: "png" }, maskPng: onePxPng };
  await mount(lolevLayers());
  await exported(() => api.exportPsd());
  const [{ job, transfer }] = cost.psdJobs;
  const pixels = [
    job.assets.images![PAGE_ART_ID.background]!, job.assets.images![PAGE_ART_ID.mask]!,
    job.opts.composite!, job.opts.whiteInk!,
  ];
  expect(new Set(transfer)).toEqual(new Set(pixels.map(({ data }) => data.buffer)));
  for (const font of Object.values(job.assets.fonts)) expect(transfer).not.toContain(font.buffer);
}, 30_000);

it("copies a PSD pair's pixels: both jobs read them", async () => {
  stubDecodes();
  pageArt = { texture: { bytes: onePxPng, kind: "png" } };
  await mount(lolevLayers());
  await exported(() => api.exportPsd({}, "pair"));
  expect(cost.psdJobs.map(({ transfer }) => transfer ?? [])).toEqual([[], []]);
}, 30_000);
