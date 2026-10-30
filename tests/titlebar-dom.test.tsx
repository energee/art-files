// titlebar-dom.test.tsx — the macOS overlay title bar (src/titlebar.ts). The
// layout changes apply only in the Tauri desktop app on macOS: <html> gets
// data-titlebar="overlay" (and data-fullscreen while the traffic lights are
// gone) and the editor's header becomes the window's drag region. The Layers
// toggle sits at one fixed spot beside the traffic lights, the same whether
// the sidebar is open or collapsed, and is the only toggle. Everywhere else
// (a browser, Windows, Linux) none of it applies. Layout itself is measured on
// the real window (see .superpowers/titlebar when it was built); this pins
// the gate, the attributes and the classes that produce it.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const host = vi.hoisted(() => ({ tauri: false }));
const win = vi.hoisted(() => ({ isFullscreen: vi.fn(), onResized: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => host.tauri }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: win.isFullscreen, onResized: win.onResized }),
}));
// Under Tauri the menu is native (installed through IPC); it renders nothing.
vi.mock("../src/components/AppMenu", () => ({ AppMenu: () => null }));
vi.mock("../src/masterCache", () => ({ cacheMaster: async () => {}, cachedMaster: async () => null, dropCachedMaster: async () => {} }));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: () => new Promise<never>(() => {}),
  labelFontCss: () => "sans-serif",
}));
const { DocumentEditor } = await import("../src/App");
const { initTitlebar, overlayTitlebar } = await import("../src/titlebar");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;

const setUserAgent = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  localStorage.clear();
  host.tauri = true;
  setUserAgent(MAC);
  win.isFullscreen.mockReset().mockResolvedValue(false);
  win.onResized.mockReset().mockResolvedValue(() => {});
});
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  Reflect.deleteProperty(navigator, "userAgent");
  document.body.replaceChildren();
  localStorage.clear();
});

describe("the platform gate", () => {
  const html = () => document.createElement("html");

  it("marks <html> only in the Tauri app on macOS", () => {
    for (const [tauri, ua, marked] of [[true, MAC, true], [true, WINDOWS, false], [false, MAC, false], [false, WINDOWS, false]] as const) {
      host.tauri = tauri;
      setUserAgent(ua);
      const root = html();
      initTitlebar(root);
      expect(overlayTitlebar(), `tauri=${tauri} ua=${ua}`).toBe(marked);
      expect(root.dataset.titlebar, `tauri=${tauri} ua=${ua}`).toBe(marked ? "overlay" : undefined);
    }
  });

  it("asks the window nothing off macOS or outside Tauri", () => {
    host.tauri = true;
    setUserAgent(WINDOWS);
    initTitlebar(html());
    expect(win.onResized).not.toHaveBeenCalled();
    expect(win.isFullscreen).not.toHaveBeenCalled();
  });

  it("drops the room for the traffic lights in full screen and restores it after", async () => {
    win.isFullscreen.mockResolvedValue(true);
    const root = html();
    initTitlebar(root);
    await vi.waitFor(() => expect(root.hasAttribute("data-fullscreen")).toBe(true));
    expect(root.dataset.titlebar).toBe("overlay");
    // Leaving full screen resizes the window; the listener re-reads the state.
    win.isFullscreen.mockResolvedValue(false);
    await act(async () => { await win.onResized.mock.calls[0][0](); });
    expect(root.hasAttribute("data-fullscreen")).toBe(false);
  });

  // The `titlebar:` classes only apply while the attributes src/titlebar.ts
  // sets are on <html>, outside full screen; the two files name them alike.
  it("is the selector index.css's titlebar: variant keys on", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toContain('@custom-variant titlebar (:root[data-titlebar="overlay"]:not([data-fullscreen]) &);');
  });
});

describe("the editor under the overlay title bar", () => {
  async function mount() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props: ComponentProps<typeof DocumentEditor> = {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    };
    await act(async () => { root.render(createElement(DocumentEditor, props)); });
    cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
    return container;
  }
  const dragRegions = (c: HTMLElement) => [...c.querySelectorAll("[data-tauri-drag-region]")].map((e) => e.tagName + (e.getAttribute("class")?.includes("titlebar:block") ? ".strip" : ""));

  it("drags the window by its header and by the sidebar's traffic-light strip", async () => {
    const c = await mount();
    expect(dragRegions(c)).toEqual(["DIV.strip", "HEADER"]);
    // A bare attribute: only the header's own surface drags, never its buttons.
    expect(c.querySelector("header")?.getAttribute("data-tauri-drag-region")).toBe("");
  });

  it("leaves the window to the OS title bar off macOS", async () => {
    setUserAgent(WINDOWS);
    const c = await mount();
    expect(c.querySelector("header")?.hasAttribute("data-tauri-drag-region")).toBe(false);
  });

  it("keeps the Layers toggle in one fixed place whether the sidebar is open or collapsed", async () => {
    const c = await mount();
    const triggers = () => c.querySelectorAll<HTMLElement>("[data-slot=sidebar-trigger]");
    const state = () => c.querySelector("[data-slot=sidebar]")!.getAttribute("data-state");
    expect(triggers()).toHaveLength(1);
    const open = triggers()[0].className;
    // Fixed to the window, right of the traffic lights, above the sidebar.
    for (const cls of ["titlebar:fixed", "titlebar:top-[6px]", "titlebar:left-24", "titlebar:z-20"]) {
      expect(open.split(/\s+/), cls).toContain(cls);
    }
    expect(state()).toBe("expanded");
    await act(async () => { triggers()[0].click(); });
    expect(state()).toBe("collapsed");
    expect(triggers()).toHaveLength(1);
    expect(triggers()[0].className).toBe(open);
    // Still named and described as before.
    expect(triggers()[0].getAttribute("aria-label")).toBe("Layers");
    expect(triggers()[0].getAttribute("title")).toBe("Layers (⌘B)");
  });

  it("keeps the header its height now that the toggle leaves its flow", async () => {
    const c = await mount();
    expect(c.querySelector("header")?.className.split(/\s+/)).toContain("titlebar:h-10");
  });
});
