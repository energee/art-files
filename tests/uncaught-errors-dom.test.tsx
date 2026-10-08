// @vitest-environment happy-dom
// uncaught-errors-dom.test.tsx — an async failure nobody caught (a rejected
// save/export/open promise, or a throw in an event handler) is logged and
// shown in a dismissible alert instead of vanishing silently (#398).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { UncaughtErrors } from "@/components/UncaughtErrors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(UncaughtErrors)));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

/** happy-dom has no PromiseRejectionEvent; the listener reads only `reason`. */
function rejection(reason: unknown) {
  return Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason });
}

it("shows and logs an unhandled promise rejection", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { host, done } = mount();
  expect(host.querySelector("[role=alert]")).toBeNull();
  act(() => { window.dispatchEvent(rejection(new Error("export failed: disk full"))); });
  expect(host.querySelector("[role=alert]")?.textContent).toContain("export failed: disk full");
  expect(log).toHaveBeenCalled();
  done();
});

it("shows an uncaught error event, and Dismiss clears it", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { host, done } = mount();
  act(() => {
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: new Error("boom in handler") }));
  });
  expect(host.querySelector("[role=alert]")?.textContent).toContain("boom in handler");
  const dismiss = [...host.querySelectorAll("button")].find((b) => b.textContent === "Dismiss")!;
  act(() => dismiss.click());
  expect(host.querySelector("[role=alert]")).toBeNull();
  done();
});

it("ignores a cancelled picker (AbortError) and the benign ResizeObserver loop notice", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { host, done } = mount();
  act(() => {
    window.dispatchEvent(rejection(new DOMException("The user aborted a request.", "AbortError")));
    window.dispatchEvent(new ErrorEvent("error", {
      message: "ResizeObserver loop completed with undelivered notifications.",
    }));
  });
  expect(host.querySelector("[role=alert]")).toBeNull();
  done();
});

it("stops listening once unmounted", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { done } = mount();
  done();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  window.dispatchEvent(rejection(new Error("late")));
  expect(log).not.toHaveBeenCalled();
});
