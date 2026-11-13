// tests/phone-layout-dom.test.tsx — usePhoneLayout's two flags at the sizes the
// spec names (phone layout, phase 2).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { usePhoneLayout } from "../src/usePhoneLayout";
import { setViewport } from "./viewport";

let seen: { phone: boolean; narrow: boolean };
let root: Root;
const Probe = () => { seen = usePhoneLayout(); return null; };

beforeEach(() => { setViewport(1280, 800); root = createRoot(document.createElement("div")); act(() => root.render(createElement(Probe))); });
afterEach(() => { act(() => root.unmount()); setViewport(1024, 768); });

it.each([
  [390, 844, true, true],    // phone, upright
  [844, 390, true, false],   // phone, sideways: Layers overlays, inspector stays right
  [767, 1024, true, true],
  [768, 1024, false, false], // tablet: desktop layout
  [1280, 800, false, false],
  [1280, 499, true, false],
  [1280, 500, false, false],
])("at %ix%i phone is %s and narrow is %s", (width, height, phone, narrow) => {
  act(() => setViewport(width, height));
  expect(seen).toEqual({ phone, narrow });
});
