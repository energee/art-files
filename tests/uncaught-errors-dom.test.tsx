// @vitest-environment happy-dom
// uncaught-errors-dom.test.tsx — an async failure nobody caught (a rejected
// save/export/open promise, or a throw in an event handler) is logged and
// shown as an error toast that stays until dismissed, instead of vanishing
// silently (#398). The latest failure replaces the one before it.
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { UncaughtErrors } from "@/components/UncaughtErrors";
import { mount, setupToastHarness, settleDismissal, show, text, toastCount } from "./toast-harness";

setupToastHarness();

afterEach(() => vi.restoreAllMocks());

/** happy-dom has no PromiseRejectionEvent; the listener reads only `reason`. */
function rejection(reason: unknown) {
  return Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason });
}

it("an unhandled rejection shows an error toast that stays until dismissed", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mount(createElement(UncaughtErrors));
  expect(toastCount()).toBe(0);

  show(() => window.dispatchEvent(rejection(new Error("export failed: disk full"))));
  expect(toastCount()).toBe(1);
  expect(text()).toContain("Something went wrong");
  expect(text()).toContain("export failed: disk full");
  expect(text()).toContain("The last action may not have finished.");
  expect(log).toHaveBeenCalled();

  // Nothing fades it.
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(toastCount()).toBe(1);

  act(() => { document.querySelector<HTMLButtonElement>("[data-close-button]")!.click(); });
  settleDismissal();
  expect(toastCount()).toBe(0);
});

it("an uncaught error event shows an error toast", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mount(createElement(UncaughtErrors));
  show(() => window.dispatchEvent(
    new ErrorEvent("error", { message: "boom", error: new Error("boom in handler") }),
  ));
  expect(toastCount()).toBe(1);
  expect(text()).toContain("boom in handler");
});

it("falls back to the event message, shows a non-Error rejection as text, and the latest replaces the last", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mount(createElement(UncaughtErrors));
  show(() => window.dispatchEvent(new ErrorEvent("error", { message: "message only" })));
  expect(text()).toContain("message only");
  // Tauri's invoke rejects with a plain string.
  show(() => window.dispatchEvent(rejection("write_file: permission denied")));
  expect(text()).toContain("write_file: permission denied");
  expect(text()).not.toContain("message only");
  expect(toastCount()).toBe(1);
});

it("an aborted picker shows nothing", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mount(createElement(UncaughtErrors));
  show(
    () => window.dispatchEvent(rejection(new DOMException("The user aborted a request.", "AbortError"))),
    // The benign ResizeObserver loop notice is no failure either.
    () => window.dispatchEvent(new ErrorEvent("error", {
      message: "ResizeObserver loop completed with undelivered notifications.",
    })),
  );
  expect(toastCount()).toBe(0);
  expect(log).not.toHaveBeenCalled();
});

it("stops listening once unmounted", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mount(createElement(UncaughtErrors));
  mount(); // the same toaster, without UncaughtErrors
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  show(() => window.dispatchEvent(rejection(new Error("late"))));
  expect(log).not.toHaveBeenCalled();
  expect(toastCount()).toBe(0);
});
