// tabstrip-a11y-dom.test.tsx — the shell's tab strip is a real tablist
// (#404): each document tab carries role="tab" and aria-selected, so a
// screen reader announces which tab is active, shows a focus ring when
// reached by keyboard, and keeps keyboard focus on the selected tab after an
// Enter/Space switch, + or close re-hosts the strip, and bare Left/Right move
// focus between tabs. DocumentEditor is stubbed: it hands the shell a slot
// for the strip (the real tabStripHost contract) and exposes onNewTab and
// the active tab's onMeta.
// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DocumentMeta } from "../src/App";

const mocks = vi.hoisted(() => ({
  newTab: null as null | (() => void),
  onMeta: null as null | ((meta: DocumentMeta) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", () => ({
  DocumentEditor: ({ active, tabStripHost, onNewTab, onMeta }: {
    active: boolean; tabStripHost: (el: HTMLDivElement | null) => void; onNewTab: () => void;
    onMeta: (meta: DocumentMeta) => void;
  }) => {
    if (active) { mocks.newTab = onNewTab; mocks.onMeta = onMeta; }
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
  expect(document.activeElement).toBe(tabs()[0]);
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
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

it("lets go of focus when the mouse clicks the already-active tab", async () => {
  // Chromium focuses a button on mouse click; nothing re-hosts for the
  // active tab, so the click itself must release focus for the arrows.
  tabs()[0].focus();
  await act(async () => {
    tabs()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  expect(document.activeElement?.getAttribute("role")).not.toBe("tab");
});

it("moves focus between tabs with Left/Right, wrapping, without switching", async () => {
  await act(async () => { mocks.newTab?.(); });
  const press = (key: string) => act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  tabs()[0].focus();
  await press("ArrowRight");
  expect(document.activeElement).toBe(tabs()[1]);
  await press("ArrowRight");
  expect(document.activeElement).toBe(tabs()[0]);
  await press("ArrowLeft");
  expect(document.activeElement).toBe(tabs()[1]);
  // From a tab's close button too: it sits in that tab's chip.
  (document.querySelector('[aria-label^="Close "]') as HTMLElement).focus();
  await press("ArrowRight");
  expect(document.activeElement).toBe(tabs()[1]);
  // Focus only: the second tab (from New Tab) is still the selected one.
  expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  // A modified arrow (⌘← is "go back") is not the strip's to take.
  const modified = new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true, bubbles: true, cancelable: true });
  await act(async () => { document.activeElement?.dispatchEvent(modified); });
  expect(document.activeElement).toBe(tabs()[1]);
  expect(modified.defaultPrevented).toBe(false);
});

it("keeps keyboard focus on the strip when Enter on + adds a tab", async () => {
  const plus = document.querySelector<HTMLElement>('[aria-label="New tab"]')!;
  plus.focus();
  await act(async () => { plus.click(); });
  // The new tab is selected and the strip re-hosted; focus follows it.
  expect(tabs()).toHaveLength(2);
  expect(document.activeElement).toBe(tabs()[1]);
});

it("refocuses the strip once the unsaved-close dialog is cancelled", async () => {
  await act(async () => { mocks.newTab?.(); });
  await act(async () => {
    mocks.onMeta?.({ title: "Draft", dirty: true, edited: true, masterUnsaved: false, filePath: null });
  });
  const close = document.querySelector<HTMLElement>('[aria-label="Close Draft (unsaved changes)"]')!;
  close.focus();
  await act(async () => { close.click(); });
  const cancel = [...document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"] button')]
    .find((b) => b.textContent === "Cancel")!;
  await act(async () => { cancel.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  // The tab stays, and focus lands on it rather than a detached ×.
  expect(tabs()).toHaveLength(2);
  expect(document.activeElement).toBe(tabs()[1]);
});

it("keeps keyboard focus on the strip when Enter closes a tab", async () => {
  await act(async () => { mocks.newTab?.(); });
  await act(async () => { mocks.newTab?.(); });
  const closeBtns = () => [...document.querySelectorAll<HTMLElement>('[aria-label^="Close "]')];
  // Close the active (last) tab: its left neighbour takes over and the
  // strip re-hosts in that editor's slot.
  await act(async () => { closeBtns()[2].click(); });
  expect(tabs()).toHaveLength(2);
  expect(document.activeElement).toBe(tabs()[1]);
  // Close an inactive tab: nothing re-hosts, but its × is gone. Focus goes
  // to the tab that took its place, not back to the selected one.
  await act(async () => { mocks.newTab?.(); });
  await act(async () => { closeBtns()[0].click(); });
  expect(tabs()).toHaveLength(2);
  expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabs()[0]);
});

// #424: a hover-only × is invisible to touch and to anyone who hasn't found
// it. The active tab shows its × dimmed at rest; inactive tabs keep it for
// hover so the strip doesn't fill with ×s.
it("shows the active tab's close button without hover", async () => {
  await act(async () => { mocks.newTab?.(); });
  const closeBtns = [...document.querySelectorAll<HTMLElement>('[aria-label^="Close "]')];
  expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  expect(closeBtns[1].className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
  expect(closeBtns[0].className).toMatch(/(^|\s)opacity-0(\s|$)/);
});
