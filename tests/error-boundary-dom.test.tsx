// error-boundary-dom.test.tsx — a render throw shows the recovery alert with
// the error message instead of unmounting the tree.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error("layer 7 has no font");
}

it("renders the alert and the message when a child throws", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ErrorBoundary, null, createElement(Boom))));
  const alert = host.querySelector("[role=alert]");
  expect(alert?.textContent).toContain("layer 7 has no font");
  expect(host.querySelector("button")?.textContent).toBe("Reload Label Lab");
  act(() => root.unmount());
  host.remove();
});

it("renders children when nothing throws", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(ErrorBoundary, null, "fine")));
  expect(host.textContent).toBe("fine");
  act(() => root.unmount());
});
