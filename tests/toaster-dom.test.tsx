// toaster-dom.test.tsx — the app's one Sonner toaster (src/components/ui/
// sonner.tsx) and the notify helper (src/notify.ts) that every message goes
// through: how long each kind stays, where the stack sits, which theme it
// wears, how many toasts show at once, and how screen readers are told.
// Sonner renders into the document, so the real <Toaster /> is mounted under
// happy-dom with fake timers driving its auto-dismiss and exit animation.
// Sonner defers showing a toast with setTimeout and hiding one with
// requestAnimationFrame, so both are faked and every notify call goes through
// show() to let the toast land before the test looks.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { notify } from "@/notify";

let container: HTMLDivElement;
let root: Root;

/** Mount the toaster; call before the first notify so Sonner is subscribed. */
function mountToaster() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(createElement(Toaster)); });
}

/** Let time pass inside act so Sonner's timers and state updates flush. */
function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

/** Run notify calls, then let Sonner's deferred render of them happen. */
function show(...calls: Array<() => unknown>) {
  act(() => {
    for (const call of calls) call();
    vi.advanceTimersByTime(0);
  });
}

/** Sonner keeps a dismissed toast mounted for its exit animation (~200 ms). */
const EXIT_MS = 500;

const toastCount = () => document.querySelectorAll("[data-sonner-toast]").length;
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"] });
});

afterEach(() => {
  // Sonner's store outlives the Toaster and replays what is still active to the
  // next one that mounts, so retire every toast before the next test.
  toast.dismiss();
  act(() => { root.unmount(); });
  container.remove();
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
  vi.useRealTimers();
});

it("a success toast shows its title and fades after 4 s", () => {
  mountToaster();
  show(() => notify.success("Saved Lupula.pdf"));
  expect(text()).toContain("Saved Lupula.pdf");

  advance(3900);
  expect(text()).toContain("Saved Lupula.pdf");

  advance(100 + EXIT_MS);
  expect(text()).not.toContain("Saved Lupula.pdf");
});

it("warnings and errors stay until dismissed and have a close button", () => {
  mountToaster();
  show(
    () => notify.warning("Lupula-mask.pdf wasn't saved"),
    () => notify.error("Couldn't save Lupula.pdf"),
  );

  advance(60_000);
  expect(text()).toContain("Lupula-mask.pdf wasn't saved");
  expect(text()).toContain("Couldn't save Lupula.pdf");

  const closers = document.querySelectorAll<HTMLButtonElement>("[data-close-button]");
  expect(closers).toHaveLength(2);

  // Each toast owns a close button, so closing the first one removes only it.
  const warning = [...document.querySelectorAll("[data-sonner-toast]")]
    .find((li) => li.textContent?.includes("wasn't saved"))!;
  act(() => { warning.querySelector<HTMLButtonElement>("[data-close-button]")!.click(); });
  advance(EXIT_MS);
  expect(text()).not.toContain("Lupula-mask.pdf wasn't saved");
  expect(text()).toContain("Couldn't save Lupula.pdf");
});

it("an info toast stays 8 s, longer than a success", () => {
  mountToaster();
  show(() => notify.info("Switched to “Lolev”"));

  advance(7900);
  expect(text()).toContain("Switched to “Lolev”");

  advance(100 + EXIT_MS);
  expect(text()).not.toContain("Switched to “Lolev”");
});

it("sits at the bottom centre", () => {
  mountToaster();
  show(() => notify.success("Saved"));
  const toaster = document.querySelector("[data-sonner-toaster]")!;
  expect(toaster.getAttribute("data-y-position")).toBe("bottom");
  expect(toaster.getAttribute("data-x-position")).toBe("center");
});

it("follows the app theme", () => {
  document.documentElement.dataset.theme = "dark";
  mountToaster();
  show(() => notify.success("Saved"));
  expect(document.querySelector("[data-sonner-toaster]")!.getAttribute("data-sonner-theme")).toBe("dark");
});

it("keeps four toasts visible", () => {
  mountToaster();
  show(...[1, 2, 3, 4].map((n) => () => notify.warning(`Warning ${n}`)));
  expect(toastCount()).toBe(4);
  const visible = [...document.querySelectorAll("[data-sonner-toast]")]
    .map((li) => li.getAttribute("data-visible"));
  expect(visible).toEqual(["true", "true", "true", "true"]);
});

it("announces errors assertively and successes politely", () => {
  mountToaster();
  show(
    () => notify.error("Couldn't save Lupula.pdf"),
    () => notify.success("Saved Lupula.pdf"),
  );
  const assertive = '[aria-live="assertive"], [role="alert"]';
  /** The innermost element holding exactly this text. */
  const elementWith = (message: string) => [...document.querySelectorAll("[data-sonner-toast] *")]
    .find((el) => el.children.length === 0 && el.textContent === message)!;

  expect(elementWith("Couldn't save Lupula.pdf").closest(assertive)).not.toBeNull();
  expect(elementWith("Saved Lupula.pdf").closest(assertive)).toBeNull();
  expect(elementWith("Saved Lupula.pdf").closest('[aria-live="polite"]')).not.toBeNull();
});

it("replaces a toast that reuses its id instead of stacking a second", () => {
  mountToaster();
  show(() => notify.warning("First", { id: "tab-1:resolve" }));
  show(() => notify.warning("Second", { id: "tab-1:resolve" }));
  expect(toastCount()).toBe(1);
  expect(text()).toContain("Second");
  expect(text()).not.toContain("First");
});

it("dismisses a toast by id, and runs its action on click", () => {
  mountToaster();
  const onClick = vi.fn();
  show(() => notify.error("Can't export yet", { id: "blocked", description: "Barcode is invalid", action: { label: "Show layer", onClick } }));
  expect(text()).toContain("Barcode is invalid");

  act(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Show layer")!.click();
  });
  expect(onClick).toHaveBeenCalledTimes(1);

  act(() => { notify.dismiss("blocked"); });
  advance(EXIT_MS);
  expect(text()).not.toContain("Can't export yet");
});

it("runs onDismiss when a toast is closed or dismissed by id, not when it fades or its action is clicked", () => {
  mountToaster();
  const closed = vi.fn();
  const byId = vi.fn();
  const acted = vi.fn();
  const faded = vi.fn();
  show(
    () => notify.warning("Closed by the user", { id: "closed", onDismiss: closed }),
    () => notify.warning("Dismissed by id", { id: "by-id", onDismiss: byId }),
    () => notify.warning("Action clicked", { id: "acted", onDismiss: acted, action: { label: "Fix", onClick: () => {} } }),
    () => notify.success("Fades on its own", { onDismiss: faded }),
  );

  const closeButton = [...document.querySelectorAll("[data-sonner-toast]")]
    .find((li) => li.textContent?.includes("Closed by the user"))!
    .querySelector<HTMLButtonElement>("[data-close-button]")!;
  act(() => { closeButton.click(); });
  act(() => { notify.dismiss("by-id"); });
  act(() => { [...document.querySelectorAll("button")].find((b) => b.textContent === "Fix")!.click(); });
  // A dismissal by id finishes in two steps, so time passes twice (see the
  // matching helper in tests/use-owned-toast-dom.test.tsx).
  advance(EXIT_MS);
  advance(EXIT_MS);
  advance(5000);

  expect(closed).toHaveBeenCalledTimes(1);
  expect(byId).toHaveBeenCalledTimes(1);
  expect(acted).not.toHaveBeenCalled();
  expect(faded).not.toHaveBeenCalled();
});
