// view-prefs-dom.test.tsx — the saved view preferences (rulers, guides, the
// length unit, the 3D light angle): defaults on a fresh profile, a mangled
// entry falls back instead of crashing boot, and each setter persists.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it } from "vitest";
import { loadViewPrefs, useViewPrefs, VIEW_KEY } from "../src/useViewPrefs";

beforeEach(() => localStorage.clear());

it("defaults on a fresh profile", () => {
  expect(loadViewPrefs()).toEqual({ showRulers: true, showGuides: true, unit: "in", lightDeg: 0 });
});

it("keeps only valid stored values", () => {
  localStorage.setItem(VIEW_KEY, JSON.stringify({ showRulers: false, unit: "cubits", lightDeg: 999, extra: 1 }));
  expect(loadViewPrefs()).toEqual({ showRulers: false, showGuides: true, unit: "in", lightDeg: 0 });
  localStorage.setItem(VIEW_KEY, "{not json");
  expect(loadViewPrefs().unit).toBe("in");
});

it("persists each setter", () => {
  let prefs!: ReturnType<typeof useViewPrefs>;
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(() => { prefs = useViewPrefs(); return null; })));
  act(() => {
    prefs.setShowRulers(false);
    prefs.setShowGuides(false);
    prefs.setUnit("mm");
    prefs.setLightDeg(45);
  });
  expect(JSON.parse(localStorage.getItem(VIEW_KEY)!)).toEqual({ showRulers: false, showGuides: false, unit: "mm", lightDeg: 45 });
  expect(loadViewPrefs()).toEqual({ showRulers: false, showGuides: false, unit: "mm", lightDeg: 45 });
  act(() => root.unmount());
});
