// toast-anchor-dom.test.tsx — usePreviewToastAnchor (src/toastAnchor.ts) points
// the toast stack at the active tab's preview pane: it sets --toast-center-x
// and --toast-bottom on <html> from the pane's rect, follows pane and window
// resizes, and never writes from an inactive tab or after it deactivates.
// happy-dom has no layout, so the pane's rect, the window height and
// ResizeObserver are stubbed.
// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreviewToastAnchor } from "@/toastAnchor";

let root: Root;
let container: HTMLDivElement;
let rect: { left: number; width: number; bottom: number };
let observers: FakeResizeObserver[];

class FakeResizeObserver {
  disconnected = false;
  constructor(readonly callback: () => void) { observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
}

function Editor({ active }: { active: boolean }) {
  const pane = useRef<HTMLDivElement>(null);
  usePreviewToastAnchor(pane, active);
  return createElement("div", { ref: pane });
}

const mount = (active: boolean) => act(() => { root.render(createElement(Editor, { active })); });
const anchor = (name: string) => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  rect = { left: 256, width: 800, bottom: 760 };
  observers = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("innerHeight", 800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect as DOMRect);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("the active editor centres toasts over its pane", () => {
  mount(true);
  expect(anchor("--toast-center-x")).toBe("656px");
  expect(anchor("--toast-bottom")).toBe("48px");
});

it("an inactive editor leaves the anchor alone", () => {
  mount(false);
  expect(anchor("--toast-center-x")).toBe("");
  expect(anchor("--toast-bottom")).toBe("");
  expect(observers).toHaveLength(0);
});

it("a pane resize moves the anchor", () => {
  mount(true);
  rect = { ...rect, width: 600 };
  act(() => observers[0].callback());
  expect(anchor("--toast-center-x")).toBe("556px");
});

it("a window resize moves the anchor", () => {
  mount(true);
  vi.stubGlobal("innerHeight", 900);
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(anchor("--toast-bottom")).toBe("148px");
});

it("stops following the pane once the editor goes inactive or unmounts", () => {
  mount(true);
  mount(false);
  expect(observers[0].disconnected).toBe(true);
  rect = { ...rect, width: 600 };
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(anchor("--toast-center-x")).toBe("656px");
});
