// inspector-rerender-dom.test.tsx — what a keystroke or a drag costs the
// inspector (#715). The sections are memoized on the slice of the layer they
// read, so these count their leaves: ScrubField and ColorField are the real
// components around a render counter. The second half is the other side of
// that memo: nothing it skips may leave a stale value or callback behind.
// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Layer, TextLayer } from "../src/model/layers";

const { renders, counted, preview } = await vi.hoisted(async () => {
  const { createElement } = await import("react");
  const renders = { ScrubField: 0, ColorField: 0 };
  const counted = (name: keyof typeof renders, Real: ComponentType<object>) => (props: object) => {
    // The character height is measured from the text, so it should follow it.
    if (!(props as { id: string }).id.endsWith("-min-character-height")) renders[name]++;
    return createElement(Real, props);
  };
  return {
    renders, counted,
    preview: { canvasRender: null as unknown, onDrag: (_id: string, _dx: number, _dy: number, _first: boolean): unknown => null },
  };
});
vi.mock("../src/components/ScrubField", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/components/ScrubField")>();
  return { ...m, ScrubField: counted("ScrubField", m.ScrubField as ComponentType<object>) };
});
vi.mock("../src/components/ColorField", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/components/ColorField")>();
  return { ...m, ColorField: counted("ColorField", m.ColorField as ComponentType<object>) };
});
vi.mock("../src/components/PreviewCompare", () => ({
  SNAP_PT: 6,
  PreviewCompare: (p: typeof preview) => { Object.assign(preview, p); return null; },
}));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
  FONT_URLS: { poppins: {}, "barlow-condensed": {} },
}));
import { DocumentEditor } from "../src/App";
import { LayerInspector } from "../src/components/LayerInspector";
import { setLanguage, t } from "../src/i18n";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const counts = () => ({ ...renders });

describe("in the app", () => {
  const mount = async () => {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
        saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    await act(async () => {
      (container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
  };

  it("typing in the Text field re-renders no inspector section", async () => {
    await mount();
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
    const typeText = (text: string) => act(async () => {
      editor.innerHTML = `<div>${text}</div>`;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await typeText("P");
    const before = counts();
    for (const text of ["Pe", "Per", "Pere"]) await typeText(text);
    expect(counts()).toEqual(before);
  });

  it("dragging the layer re-renders Position, and no other section", async () => {
    await mount();
    // Gestures measure boxes off the canvas assets, which load after mount.
    await vi.waitFor(() => expect(preview.canvasRender).not.toBeNull(), { timeout: 30_000 });
    await act(async () => { preview.onDrag("name", 10, 0, true); });
    const x = container.ownerDocument.querySelector("#name-x") as HTMLInputElement;
    const start = x.value;
    const before = counts();
    await act(async () => { preview.onDrag("name", 20, 0, false); });
    await act(async () => { preview.onDrag("name", 30, 0, false); });
    expect(x.value).not.toBe(start);
    expect(renders.ColorField).toBe(before.ColorField);
    // X and Y on each of the two moves; Typography's five stay put.
    expect(renders.ScrubField - before.ScrubField).toBe(4);
  }, 60_000);
});

describe("what the memo skips", () => {
  const STYLE = { fill: "#F3CD80", layer: "metallic" } as const;
  const layer = (over: Partial<TextLayer> = {}): TextLayer => ({
    id: "name", name: "Name", kind: "text", enabled: true, x: 100, anchor: "center", y: 20,
    lines: [{ text: "Hazy", ...STYLE }], size: 15.83, align: "center", style: STYLE, ...over,
  });
  type Props = Parameters<typeof LayerInspector>[0];
  /** Fresh closures and Sets on every call, the way App renders the inspector. */
  const show = (l: Layer, over: Partial<Props> = {}) => {
    const props: Props = {
      layer: l, layerNames: [{ id: "name", name: "Name" }, { id: "logo", name: "Logo" }],
      overridden: { variant: new Set<string>(), label: new Set<string>() },
      onChange: vi.fn(), onReset: vi.fn(), onUnbind: vi.fn(), onBind: vi.fn(), ...over,
    };
    act(() => { root.render(createElement(LayerInspector, props)); });
    return props;
  };
  const type = (selector: string, value: string) => {
    const input = container.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = (selector: string) => act(() => {
    container.querySelector(selector)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  it("skips a render whose only change is the layer's content and its closures", () => {
    show(layer());
    const before = counts();
    show(layer({ lines: [{ text: "Hazy IPA", ...STYLE }] }));
    expect(counts()).toEqual(before);
  });

  it("a section it skipped writes through the latest onChange", () => {
    const first = show(layer());
    const second = show(layer({ lines: [{ text: "Hazy IPA", ...STYLE }] }));
    type("#name-size", "20");
    expect(second.onChange).toHaveBeenLastCalledWith({ size: 20 });
    expect(first.onChange).not.toHaveBeenCalled();
  });

  it("a badge it skipped resets through the latest onReset", () => {
    const overridden = () => ({ variant: new Set<string>(), label: new Set(["size"]) });
    const first = show(layer(), { overridden: overridden() });
    const second = show(layer(), { overridden: overridden() });
    click('[aria-label="Reset Size to this label\'s master value"]');
    expect(second.onReset).toHaveBeenCalledWith("size", "label");
    expect(first.onReset).not.toHaveBeenCalled();
  });

  it("a skipped Unbind and Side run the latest onUnbind and onBind", () => {
    const bound = layer({ binding: { to: "logo", side: "bottom", gap: 4 } });
    const first = show(bound);
    const second = show(bound);
    click(".space-y-1\\.5 button.w-full");
    expect(second.onUnbind).toHaveBeenCalledTimes(1);
    expect(first.onUnbind).not.toHaveBeenCalled();
  });

  it("a language change relabels the sections though their props did not change", async () => {
    show(layer());
    expect(container.textContent).toContain("Typography");
    try {
      await act(async () => { await setLanguage("es"); });
      expect(t("Typography")).not.toBe("Typography");
      expect(container.textContent).toContain(t("Typography"));
      expect(container.textContent).toContain(t("Color"));
      expect(container.textContent).not.toContain("Typography");
    } finally {
      await act(async () => { await setLanguage("en"); });
    }
  });

  it("still shows every change to what a section reads", () => {
    show(layer());
    const fill = '[aria-label="Fill color"]';
    show(layer({ style: { ...STYLE, fill: "#112233" } }));
    expect((container.querySelector(fill) as HTMLInputElement).value.toLowerCase()).toBe("#112233");
    show(layer({ size: 30 }));
    expect((container.querySelector("#name-size") as HTMLInputElement).value).toBe("30");
    show(layer({ x: 44 }));
    expect((container.querySelector("#name-x") as HTMLInputElement).value).toBe("44");
    show(layer({ x: 72 }), { unit: "in" });
    expect((container.querySelector("#name-x") as HTMLInputElement).value).toBe("1");
    show(layer(), { overridden: { variant: new Set<string>(), label: new Set(["size"]) } });
    expect(container.querySelector('[aria-label="Reset Size to this label\'s master value"]')).not.toBeNull();
    show(layer(), { overridden: { variant: new Set(["size"]), label: new Set<string>(), variantName: "Collab" } });
    expect(container.querySelector('[aria-label="Reset Size to the master"]')?.getAttribute("title")).toContain("Collab");
    show(layer(), { fontFamily: "barlow-condensed" });
    expect(container.textContent).toContain("Barlow Condensed");
    const bound = layer({ binding: { to: "logo", side: "bottom", gap: 4 } });
    show(bound);
    show(bound, { layerNames: [{ id: "name", name: "Name" }, { id: "logo", name: "Laurel" }] });
    expect(container.textContent).toContain("Laurel");
    show(layer({ title: "Beer name", choices: [{ value: "Lager" }] }));
    expect((container.querySelector("#name-title") as HTMLInputElement).value).toBe("Beer name");
    show(layer({ choices: [{ value: "Pilsner" }] }));
    expect((container.querySelector("#name-choice-0-value") as HTMLInputElement).value).toBe("Pilsner");
  });
});
