// tabs.test.ts — pins the pure tab-strip transitions (src/tabs.ts): id
// assignment, neighbor activation on close, the always-one-tab rule, and
// routeFileOpen's focus/reuse/new routing for OS file-opens.
import { describe, expect, test } from "vitest";
import {
  activateTab, addTab, closeTab, fileTitle, initialTabs, isPristine,
  makeHiddenPropsEqual, routeFileOpen, updateTabMeta,
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

  test("a busy tab is never reused — two rapid opens can't share an editor", () => {
    const s = initialTabs();
    expect(routeFileOpen(s, "/a.label", () => true)).toEqual({ open: "new" });
    expect(routeFileOpen(s, undefined, (id) => id === s.active)).toEqual({ open: "new" });
    // busy doesn't affect focus: the path's tab is the right target anyway.
    const backed = updateTabMeta(s, s.active, opened("/a.label"));
    expect(routeFileOpen(backed, "/a.label", () => true)).toEqual({ focus: s.active });
  });
});

describe("fileTitle", () => {
  test("strips directories and the extension", () => {
    expect(fileTitle("/beers/Hazy Test.label")).toBe("Hazy Test");
  });
  test("handles Windows separators and uppercase extensions", () => {
    expect(fileTitle("C:\\beers\\BEER.LABEL")).toBe("BEER");
    expect(fileTitle("C:\\beers\\Mixed.Label")).toBe("Mixed");
  });
  test("passes through a name without the extension", () => {
    expect(fileTitle("/beers/notes.txt")).toBe("notes.txt");
  });
});

describe("makeHiddenPropsEqual", () => {
  const props = (over: object) => ({
    active: false, render: { dpi: 600 }, fileToOpen: null as unknown, other: "x", ...over,
  });
  const hiddenEditorPropsEqual = makeHiddenPropsEqual<ReturnType<typeof props>>("render");
  test("ignores render churn between two hidden renders", () => {
    expect(hiddenEditorPropsEqual(props({}), props({ render: { dpi: 300 } }))).toBe(true);
  });
  test("render changes still re-render an active editor", () => {
    expect(hiddenEditorPropsEqual(
      props({ active: true }), props({ active: true, render: { dpi: 300 } }),
    )).toBe(false);
  });
  test("activation and any other prop change re-render", () => {
    expect(hiddenEditorPropsEqual(props({}), props({ active: true }))).toBe(false);
    expect(hiddenEditorPropsEqual(props({}), props({ fileToOpen: { seq: 1 } }))).toBe(false);
    expect(hiddenEditorPropsEqual(props({}), props({}))).toBe(true);
  });
});
