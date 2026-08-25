// tabs.test.ts — pins the pure tab-strip transitions (src/tabs.ts): id
// assignment, neighbor activation on close, the always-one-tab rule, and
// routeFileOpen's focus/reuse/new routing for OS file-opens.
import { describe, expect, test } from "vitest";
import {
  activateTab, addTab, closeTab, initialTabs, isPristine, routeFileOpen,
  updateTabMeta,
} from "@/tabs";

const opened = (path: string) =>
  ({ title: path, dirty: false, edited: false, filePath: path });

describe("tab transitions", () => {
  test("boots with one active Untitled tab", () => {
    const s = initialTabs();
    expect(s.tabs).toHaveLength(1);
    expect(s.active).toBe(s.tabs[0].id);
    expect(s.tabs[0].title).toBe("Untitled");
  });

  test("addTab appends and activates, ids never repeat", () => {
    let s = initialTabs();
    const first = s.active;
    s = addTab(s);
    expect(s.tabs).toHaveLength(2);
    expect(s.active).not.toBe(first);
    const reused = closeTab(addTab(s), s.tabs[1].id);
    expect(new Set(reused.tabs.map((t) => t.id)).size).toBe(reused.tabs.length);
  });

  test("activateTab ignores unknown ids", () => {
    const s = initialTabs();
    expect(activateTab(s, 999)).toBe(s);
  });

  test("closing the active tab activates the right neighbor, left at the end", () => {
    const s = addTab(addTab(initialTabs())); // ids 1,2,3 — active 3
    const mid = activateTab(s, 2);
    expect(closeTab(mid, 2).active).toBe(3); // right neighbor
    expect(closeTab(s, 3).active).toBe(2);   // was last — left neighbor
  });

  test("closing an inactive tab keeps the active one", () => {
    const s = addTab(initialTabs());
    expect(closeTab(s, s.tabs[0].id).active).toBe(s.active);
  });

  test("closing the only tab replaces it with a fresh Untitled tab", () => {
    const s = initialTabs();
    const next = closeTab(s, s.active);
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].id).not.toBe(s.active);
    expect(isPristine(next.tabs[0])).toBe(true);
  });

  test("updateTabMeta patches one tab", () => {
    const s0 = initialTabs();
    const s = updateTabMeta(s0, s0.tabs[0].id, { dirty: false });
    expect(s.tabs[0].dirty).toBe(false);
  });

  test("updateTabMeta bails on a no-op patch", () => {
    const s0 = initialTabs();
    expect(updateTabMeta(s0, s0.tabs[0].id, { title: "Untitled" })).toBe(s0);
    expect(updateTabMeta(s0, 999, { dirty: false })).toBe(s0);
  });
});

describe("routeFileOpen", () => {
  test("focuses the tab already holding the path", () => {
    let s = addTab(initialTabs());
    s = updateTabMeta(s, s.tabs[0].id, opened("/a.label"));
    expect(routeFileOpen(s, "/a.label")).toEqual({ focus: s.tabs[0].id });
  });

  test("reuses a pristine active tab", () => {
    const s = initialTabs();
    expect(routeFileOpen(s, "/a.label")).toEqual({ reuse: s.active });
  });

  test("without a path (picker opens) it still reuses pristine or opens new", () => {
    const s0 = initialTabs();
    expect(routeFileOpen(s0)).toEqual({ reuse: s0.active });
    const edited = updateTabMeta(s0, s0.active, { edited: true });
    expect(routeFileOpen(edited)).toEqual({ open: "new" });
  });

  test("edited or file-backed active tab means a new tab", () => {
    const s0 = initialTabs();
    const edited = updateTabMeta(s0, s0.active, { edited: true });
    expect(routeFileOpen(edited, "/a.label")).toEqual({ open: "new" });
    const backed = updateTabMeta(s0, s0.active, opened("/b.label"));
    expect(routeFileOpen(backed, "/a.label")).toEqual({ open: "new" });
  });
});
