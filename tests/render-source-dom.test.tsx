// render-source-dom.test.tsx — the preview's render source (useRenderSource):
// assembly is debounced, a success makes the preview ready and clears only
// its own error toast, a failure reports through that toast and flags
// assetsFailed (which hides the "rendering label…" spinner), a background
// tab drops its decoded source unless it is the last tab shown, and a tab
// coming to the front assembles at once.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const loadLabelFaces = vi.fn();
vi.mock("../src/fonts", () => ({ loadLabelFaces: (...a: unknown[]) => loadLabelFaces(...a), labelFontCss: () => "" }));

const { useRenderSource } = await import("../src/useRenderSource");
import type { CustomFile } from "../src/assets/io";

const raster = { a: { image: { kind: "png", bytes: new Uint8Array(1) }, name: "a.png", previewUrl: "", aspect: 1 } } as Record<string, CustomFile>;

beforeEach(() => { vi.useFakeTimers(); });

function mount(active = true, liveImages: Record<string, CustomFile> = {}) {
  const assetError = { set: vi.fn(), clear: vi.fn() };
  let out!: ReturnType<typeof useRenderSource>;
  const Probe = (p: { active: boolean; keepSource: boolean }) => {
    out = useRenderSource({
      active: p.active, keepSource: p.keepSource, family: "poppins", fontOverrides: [], liveImages, texture: null, mask: null,
      bgOn: false, maskOn: false, guides: undefined, editSession: null,
      pageArt: () => ({ texture: undefined, maskPng: undefined }),
      planAssets: () => ({ custom: {} }), assetError,
    });
    return null;
  };
  const root = createRoot(document.createElement("div"));
  const rerender = (a: boolean, keepSource = false) => act(() => root.render(createElement(Probe, { active: a, keepSource })));
  rerender(active);
  return { get: () => out, assetError, rerender, root };
}

it("becomes ready after the debounce and clears its own error", async () => {
  loadLabelFaces.mockResolvedValue({});
  const h = mount();
  expect(h.get().previewReady).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(h.get().previewReady).toBe(true);
  expect(h.get().assetsFailed).toBe(false);
  expect(h.assetError.clear).toHaveBeenCalled();
  h.rerender(false);
  expect(h.get().previewReady).toBe(false);
  act(() => h.root.unmount());
});

it("reports a failed assembly", async () => {
  loadLabelFaces.mockRejectedValue(new Error("font gone"));
  const h = mount();
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(h.get().assetsFailed).toBe(true);
  expect(h.get().previewReady).toBe(false);
  expect(h.assetError.set).toHaveBeenCalledWith("font gone");
  act(() => h.root.unmount());
});

it("assembles at once when a tab comes to the front", async () => {
  loadLabelFaces.mockResolvedValue({});
  const h = mount(false);
  h.rerender(true);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(h.get().previewReady).toBe(true);
  act(() => h.root.unmount());
});

it("the last tab shown keeps its bitmaps, so going back decodes nothing and never unreadies", async () => {
  loadLabelFaces.mockResolvedValue({});
  const decode = vi.fn(async () => ({ close: vi.fn() }));
  vi.stubGlobal("createImageBitmap", decode);
  const h = mount(true, raster);
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(decode).toHaveBeenCalledTimes(1);
  h.rerender(false, true);
  expect(h.get().previewReady).toBe(true);
  h.rerender(true);
  expect(h.get().previewReady).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(decode).toHaveBeenCalledTimes(1);
  act(() => h.root.unmount());
});

it("drops the kept source once another tab takes its place", async () => {
  loadLabelFaces.mockResolvedValue({});
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", async () => ({ close }));
  const h = mount(true, raster);
  await act(() => vi.advanceTimersByTimeAsync(150));
  h.rerender(false, true);
  expect(close).not.toHaveBeenCalled();
  h.rerender(false, false);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(h.get().previewReady).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
  act(() => h.root.unmount());
});
