// tabstrip-a11y-dom.test.tsx — the shell's tab strip is a real tablist
// (#404): each document tab carries role="tab" and aria-selected, so a
// screen reader announces which tab is active, shows a focus ring when
// reached by keyboard, and keeps keyboard focus on the selected tab after an
// Enter/Space switch re-hosts the strip. DocumentEditor is stubbed: it hands the shell a slot
// for the strip (the real tabStripHost contract) and exposes onNewTab.
// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ newTab: null as null | (() => void) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", () => ({
  DocumentEditor: ({ active, tabStripHost, onNewTab }: {
    active: boolean; tabStripHost: (el: HTMLDivElement | null) => void; onNewTab: () => void;
  }) => {
    if (active) mocks.newTab = onNewTab;
    useEffect(() => {
      if (!active) return;
      const slot = document.createElement("div");
      document.body.appendChild(slot);
      tabStripHost(slot);
      return () => { tabStripHost(null); slot.remove(); };
    }, [active, tabStripHost]);
    return null;
  },
}));

const { default: TabsShell } = await import("../src/TabsShell");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(TabsShell)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const tabs = () => [...document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];

it("renders the strip as a tablist with one selected tab", async () => {
  expect(document.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBeTruthy();
  expect(tabs()).toHaveLength(1);
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");

  await act(async () => { mocks.newTab?.(); });

  // The new tab is active; the first is still a tab but no longer selected.
  expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
});

it("gives each tab a keyboard focus ring", () => {
  expect(tabs()).toHaveLength(1);
  expect(tabs()[0].className).toContain("focus-visible:ring-2");
});

it("keeps keyboard focus on the strip when Enter switches tabs", async () => {
  await act(async () => { mocks.newTab?.(); });
  const first = tabs()[0];
  first.focus();
  // A keyboard activation is a click with detail 0 — what .click() sends.
  await act(async () => { first.click(); });

  // Switching re-hosts the strip in the new editor's slot; focus follows
  // the newly selected tab instead of dropping to <body>.
  const active = document.activeElement as HTMLElement | null;
  expect(active?.getAttribute("role")).toBe("tab");
  expect(active?.getAttribute("aria-selected")).toBe("true");
  expect(active).toBe(tabs()[0]);
});

it("leaves focus alone when a mouse click switches tabs", async () => {
  await act(async () => { mocks.newTab?.(); });
  await act(async () => {
    tabs()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  // No forced focus: the arrows go back to nudging the canvas.
  expect(document.activeElement?.getAttribute("role")).not.toBe("tab");
});
