// @vitest-environment happy-dom
// use-export-dom.test.tsx — useExport's PDF pair export against a faked save
// dialog: a successful pair, a failure on the second file, a
// user cancel, and that a successful export clears only the build error it
// set itself — an unrelated asset/master/menu error survives (#473).
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

type Saved = { name: string; bytes: Uint8Array } | null;
const save = vi.hoisted(() => ({ next: [] as (() => Promise<Saved>)[], names: [] as string[] }));
vi.mock("../src/files", () => ({
  saveThrough: (bytes: Uint8Array, options: { name: string }) => {
    save.names.push(options.name);
    return save.next.shift()?.() ?? Promise.resolve({ name: options.name, bytes });
  },
}));
// The real builders run (as save-races-dom does) on the fixture fonts; only
// the save dialog is faked. An empty layer list still yields both plates.
vi.mock("../src/fonts", () => ({ FONT_URLS: { poppins: {} } }));
vi.mock("../src/pdf/fonts", async () => {
  const { assets } = await import("./fixtures");
  return { loadFonts: async () => assets.fonts };
});

const { useExport } = await import("../src/useExport");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useExport>;
let buildError = "";
let setError: (e: string) => void = () => undefined;

function Probe() {
  const [error, setBuildError] = useState("");
  buildError = error;
  setError = setBuildError;
  api = useExport({
    drawLayers: [], family: "poppins", liveImages: {}, planAssets: () => ({}) as never,
    pageArt: () => ({}), title: "T", exportBase: "beer", render: DEFAULT_RENDER, setBuildError,
  });
  return null;
}

async function mount() {
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  return root;
}

beforeEach(() => { save.next = []; save.names = []; });

it("saves both PDFs and notes them", async () => {
  const root = await mount();
  await act(async () => { await api.buildFull(); });
  expect(save.names).toEqual(["beer.pdf", "beer-mask.pdf"]);
  expect(api.exportNote).toBe("Saved beer.pdf, beer-mask.pdf.");
  expect(buildError).toBe("");
  act(() => root.unmount());
});

it("reports the first file saved and the second that failed", async () => {
  const root = await mount();
  save.next = [async () => ({ name: "beer.pdf", bytes: new Uint8Array() }), async () => { throw new Error("disk full"); }];
  await act(async () => { await api.buildFull(); });
  expect(buildError).toBe("Saved beer.pdf. Could not save beer-mask.pdf: disk full");
  expect(api.exportNote).toBe("");
  // The failure is the export's own message, so the next good export clears it.
  await act(async () => { await api.buildFull(); });
  expect(buildError).toBe("");
  act(() => root.unmount());
});

it("notes a cancelled save", async () => {
  const root = await mount();
  save.next = [async () => null];
  await act(async () => { await api.buildFull(); });
  expect(buildError).toBe("Note: Export cancelled before saving beer.pdf.");
  expect(save.names).toEqual(["beer.pdf"]);
  act(() => root.unmount());
});

it("clears its own error on success but keeps an unrelated one (#473)", async () => {
  const root = await mount();
  save.next = [async () => null];
  await act(async () => { await api.buildFull(); });
  expect(buildError).toBe("Note: Export cancelled before saving beer.pdf.");
  await act(async () => { await api.buildFull(); });
  expect(buildError).toBe("");

  act(() => setError("Could not load image: bad.png"));
  await act(async () => { await api.buildFull(); });
  expect(api.exportNote).toBe("Saved beer.pdf, beer-mask.pdf.");
  expect(buildError).toBe("Could not load image: bad.png");
  act(() => root.unmount());
});
