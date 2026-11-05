// inspector-more-dom.test.tsx — the inspector's More disclosure plumbing
// (plan docs/plans/inspector-density.md, decisions 10–12): a Heading with
// `more` draws a chevron button named by its label that reports and toggles
// its open state, and LayerInspector hands every section a Ctx carrying the
// saved More state, the toggle and `overridden(paths)` — true for a path in
// the same variant/label override sets the reset badges read. The sections
// are stubbed to capture that Ctx; no @testing-library/react in this repo.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Ctx } from "../src/components/LayerInspectorControls";
import type { TextLayer } from "../src/model/layers";

const seen: { ctx?: Ctx } = {};
vi.mock("../src/components/LayerInspectorSections", () => {
  const capture = (props: Ctx) => { seen.ctx = props; return null; };
  const none = () => null;
  return { TextGeometry: capture, ImageGeometry: none, BarcodeGeometry: none, QrGeometry: none, Position: none, StyleSection: none };
});

const { Heading } = await import("../src/components/LayerInspectorControls");
const { LayerInspector } = await import("../src/components/LayerInspector");

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  seen.ctx = undefined;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const STYLE = { fill: "#F3CD80", layer: "metallic" } as const;
const layer: TextLayer = {
  id: "name", name: "Name", kind: "text", enabled: true, x: 100, anchor: "center", y: 20,
  lines: [{ text: "Hazy", ...STYLE }], size: 15.83, align: "center", style: STYLE,
};

it("draws the More chevron with its label, reports open and toggles", () => {
  const onToggle = vi.fn();
  const draw = (open: boolean) => act(() => root.render(
    createElement(Heading, { more: { open, onToggle, label: "More Typography options" } }, "Typography")));
  draw(false);
  const button = container.querySelector('button[aria-label="More Typography options"]') as HTMLButtonElement;
  expect(button).not.toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  act(() => button.click());
  expect(onToggle).toHaveBeenCalledTimes(1);
  draw(true);
  expect(button.getAttribute("aria-expanded")).toBe("true");
});

it("keeps the heading's control slot beside the chevron", () => {
  act(() => root.render(createElement(Heading, {
    control: createElement("span", { id: "slot" }),
    more: { open: false, onToggle: () => {}, label: "More Position options" },
  }, "Position")));
  expect(container.querySelector("#slot")).not.toBeNull();
  expect(container.querySelector('[aria-label="More Position options"]')).not.toBeNull();
});

it("hands sections the More state, its toggle and overridden()", () => {
  const onMore = vi.fn();
  act(() => root.render(createElement(LayerInspector, {
    layer, layerNames: [], onChange: vi.fn(), onReset: vi.fn(), onUnbind: vi.fn(),
    overridden: { variant: new Set(["style.letterSpacing"]), label: new Set(["width"]) },
    more: { typography: true, position: false }, onMore,
  })));
  const ctx = seen.ctx!;
  expect(ctx.more).toEqual({ typography: true, position: false });
  ctx.onMore("position");
  expect(onMore).toHaveBeenCalledWith("position");
  expect(ctx.overridden(["style.letterSpacing"])).toBe(true);
  expect(ctx.overridden(["lineHeight", "width"])).toBe(true);
  expect(ctx.overridden(["guideX", "anchor"])).toBe(false);
});

it("defaults to every section collapsed", () => {
  act(() => root.render(createElement(LayerInspector, {
    layer, layerNames: [], onChange: vi.fn(), onReset: vi.fn(), onUnbind: vi.fn(),
    overridden: { variant: new Set<string>(), label: new Set<string>() },
  })));
  expect(seen.ctx!.more).toEqual({ typography: false, position: false });
});
