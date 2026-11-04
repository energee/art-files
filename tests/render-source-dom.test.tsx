// render-source-dom.test.tsx — the preview's render source (useRenderSource):
// assembly is debounced, a success makes the preview ready and clears only
// its own error toast, a failure reports through that toast and flags
// assetsFailed (which hides the "rendering label…" spinner), and a
// background tab drops its decoded source.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const loadLabelFaces = vi.fn();
vi.mock("../src/fonts", () => ({ loadLabelFaces: (...a: unknown[]) => loadLabelFaces(...a), labelFontCss: () => "" }));

const { useRenderSource } = await import("../src/useRenderSource");

beforeEach(() => { vi.useFakeTimers(); });

function mount(active = true) {
  const assetError = { set: vi.fn(), clear: vi.fn() };
  let out!: ReturnType<typeof useRenderSource>;
  const Probe = (p: { active: boolean }) => {
    out = useRenderSource({
      active: p.active, family: "poppins", fontOverrides: [], liveImages: {}, texture: null, mask: null,
      bgOn: false, maskOn: false, guides: undefined, editSession: null,
      pageArt: () => ({ texture: undefined, maskPng: undefined }),
      planAssets: () => ({ custom: {} }), assetError,
    });
    return null;
  };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { active })));
  return { get: () => out, assetError, rerender: (a: boolean) => act(() => root.render(createElement(Probe, { active: a }))), root };
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
