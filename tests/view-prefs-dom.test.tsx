// view-prefs-dom.test.tsx — the saved view preferences (rulers, guides, the
// length unit, the 3D light angle, the inspector's More sections): defaults
// on a fresh profile, a mangled entry falls back instead of crashing boot,
// each setter persists, and every tab shares the one set (#700).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { loadViewPrefs, useViewPrefs, VIEW_KEY } from "../src/useViewPrefs";

beforeEach(() => localStorage.clear());

it("defaults on a fresh profile", () => {
  expect(loadViewPrefs()).toEqual({
    showRulers: true, showGuides: true, unit: "in", lightDeg: 0, moreTypography: false, morePosition: false,
  });
});

it("keeps only valid stored values", () => {
  localStorage.setItem(VIEW_KEY, JSON.stringify({ showRulers: false, unit: "cubits", lightDeg: 999, moreTypography: "yes", extra: 1 }));
  expect(loadViewPrefs()).toEqual({
    showRulers: false, showGuides: true, unit: "in", lightDeg: 0, moreTypography: false, morePosition: false,
  });
  localStorage.setItem(VIEW_KEY, "{not json");
  expect(loadViewPrefs().unit).toBe("in");
});

it("persists each setter", () => {
  let prefs!: ReturnType<typeof useViewPrefs>;
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(() => { prefs = useViewPrefs(true); return null; })));
  act(() => {
    prefs.setShowRulers(false);
    prefs.setShowGuides(false);
    prefs.setUnit("mm");
    prefs.setLightDeg(45);
    prefs.setMoreTypography(true);
    prefs.setMorePosition(true);
  });
  const saved = { showRulers: false, showGuides: false, unit: "mm", lightDeg: 45, moreTypography: true, morePosition: true };
  expect(JSON.parse(localStorage.getItem(VIEW_KEY)!)).toEqual(saved);
  expect(loadViewPrefs()).toEqual(saved);
  act(() => root.unmount());
});

it("shares one set across tabs: a stale tab can't overwrite another's choice (#700)", () => {
  const mount = (active: boolean) => {
    const tab = { prefs: null as unknown as ReturnType<typeof useViewPrefs>, renders: 0, show: (_: boolean) => {} };
    const Tab = (props: { active: boolean }) => { tab.prefs = useViewPrefs(props.active); tab.renders++; return null; };
    const root = createRoot(document.createElement("div"));
    tab.show = (shown) => act(() => root.render(createElement(Tab, { active: shown })));
    tab.show(active);
    return { tab, root };
  };
  const one = mount(true);
  const two = mount(false);
  const hiddenRenders = two.tab.renders;
  act(() => one.tab.prefs.setUnit("mm"));
  // A hidden editor is expensive to re-run, and has no use for the change yet.
  expect(two.tab.renders).toBe(hiddenRenders);
  two.tab.show(true);
  expect(two.tab.prefs.unit).toBe("mm");
  act(() => two.tab.prefs.setShowRulers(false));
  expect(loadViewPrefs()).toMatchObject({ unit: "mm", showRulers: false });
  expect(one.tab.prefs.showRulers).toBe(false);
  act(() => { one.root.unmount(); two.root.unmount(); });
});

it("keeps a preference for the session when storage refuses the write", () => {
  let prefs!: ReturnType<typeof useViewPrefs>;
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(() => { prefs = useViewPrefs(true); return null; })));
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
  });
  try {
    act(() => prefs.setUnit("pt"));
    expect(prefs.unit).toBe("pt");
  } finally {
    vi.unstubAllGlobals();
    act(() => root.unmount());
  }
});
