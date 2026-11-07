// @vitest-environment happy-dom
// export-cost-dom.test.tsx — what one export costs, as counts: font parses
// (#736). The real builders run; only the dialog and the font loader are faked.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import type { Layer } from "../src/model/layers";
import { notify } from "../src/notify";

const cost = vi.hoisted(() => ({ fontsLoaded: [] as string[] }));
vi.mock("../src/files", () => ({
  saveThrough: async (bytes: Uint8Array, options: { name: string }) => ({ name: options.name, bytes }),
  nativeExists: async () => false,
}));
vi.mock("../src/fonts", () => ({
  loadFonts: async (id: string) => {
    cost.fontsLoaded.push(id);
    return (await import("./fixtures")).assets.fonts;
  },
}));

const { useExport } = await import("../src/useExport");
const { laurelCustom, lolevLayers } = await import("./fixtures");

let api: ReturnType<typeof useExport>;
function Probe({ layers }: { layers: Layer[] }) {
  api = useExport({
    drawLayers: layers, family: "poppins", liveImages: {},
    planAssets: () => ({ custom: laurelCustom }), pageArt: () => ({}),
    title: "T", exportBase: "Lupula", exportAgain: () => {},
  });
  return null;
}

let root: ReturnType<typeof createRoot>;
const mount = (layers: Layer[]) => act(async () => { root.render(createElement(Probe, { layers })); });
beforeEach(() => {
  cost.fontsLoaded = [];
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.restoreAllMocks();
});

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
