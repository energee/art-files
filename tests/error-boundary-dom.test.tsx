// @vitest-environment happy-dom
// error-boundary-dom.test.tsx — a render throw shows the recovery alert with
// the error message and a Reload button instead of unmounting to a blank window.
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

afterEach(() => vi.restoreAllMocks());

function Boom(): never {
  throw new Error("layer 7 has no font");
}

function mount(child: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ErrorBoundary, null, child)));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

it("renders the alert, the message and a Reload button when a child throws", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { host, done } = mount(createElement(Boom));
  expect(host.querySelector("[role=alert]")?.textContent).toContain("layer 7 has no font");
  expect(host.querySelector("button")?.textContent).toBe("Reload Label Lab");
  done();
});

it("renders children when nothing throws", () => {
  const { host, done } = mount("fine");
  expect(host.textContent).toBe("fine");
  done();
});
