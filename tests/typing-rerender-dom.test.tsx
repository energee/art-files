// typing-rerender-dom.test.tsx — typing in the inspector re-renders the
// inspector and the canvas, not the Layers list, the rulers or the menubar
// (#605). Each panel is the real memoized component, re-wrapped with its own
// comparator around a render counter, so the count drops only when App hands
// it stable props and the comparator lets the keystroke through.
// @vitest-environment happy-dom
import { act, createElement, type ComponentType, type MemoExoticComponent } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

type Memo = MemoExoticComponent<ComponentType<object>> & {
  type: ComponentType<object>; compare: ((a: object, b: object) => boolean) | null;
};
const { renders, counted } = await vi.hoisted(async () => {
  const { createElement, memo } = await import("react");
  const renders = { LayerList: 0, Rulers: 0, AppMenu: 0 };
  /** The real component around a counter: a memo keeps its inner and its
   *  comparator, anything else stays unmemoized. */
  const counted = (name: keyof typeof renders, real: unknown) => {
    const { type, compare } = real as Partial<Memo>;
    const Inner = type ?? (real as ComponentType<object>);
    const count = (props: object) => { renders[name]++; return createElement(Inner, props); };
    return type ? memo(count, compare ?? undefined) : count;
  };
  return { renders, counted };
});
vi.mock("../src/components/LayerList", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/components/LayerList")>();
  return { ...m, LayerList: counted("LayerList", m.LayerList) };
});
vi.mock("../src/components/Rulers", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/components/Rulers")>();
  return { ...m, Rulers: counted("Rulers", m.Rulers) };
});
vi.mock("../src/components/AppMenu", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/components/AppMenu")>();
  return { ...m, AppMenu: counted("AppMenu", m.AppMenu) };
});
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

it("typing in the inspector's Text field re-renders none of the Layers list, rulers or menubar", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
        saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    await act(async () => {
      (container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editor).not.toBeNull();
    // The first keystroke flips the document's dirty and undo state, which
    // the menubar shows; every keystroke after it changes only the text.
    const type = (text: string) => act(async () => {
      editor.innerHTML = `<div>${text}</div>`;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("P");
    const before = { ...renders };
    for (const text of ["Pe", "Per", "Pere"]) await type(text);
    expect(onMeta.mock.lastCall?.[0]).toMatchObject({ title: "Pere" });
    expect(renders).toEqual(before);

    // An edit the list does show still reaches it.
    const power = container.querySelector('[data-layer-id="name"] button[aria-label$=": enabled"]') as HTMLButtonElement;
    expect(power.getAttribute("aria-pressed")).toBe("true");
    await act(async () => power.click());
    expect(power.getAttribute("aria-pressed")).toBe("false");
    expect(renders.LayerList).toBeGreaterThan(before.LayerList);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
