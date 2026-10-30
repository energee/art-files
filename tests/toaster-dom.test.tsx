// @vitest-environment happy-dom
// toaster-dom.test.tsx — the app's one Sonner toaster (src/components/ui/
// sonner.tsx) and the notify helper (src/notify.ts) that every message goes
// through: how long each kind stays, where the stack sits, which theme it
// wears, how many toasts show at once, and how screen readers are told.
// Sonner renders into the document, so the real <Toaster /> is mounted under
// happy-dom with fake timers driving its auto-dismiss and exit animation
// (tests/toast-harness.ts). Every notify call goes through show() to let the
// toast land before the test looks.
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { setLanguage } from "@/i18n";
import { notify } from "@/notify";
import { EXIT_MS, advance, mount, settleDismissal, setupToastHarness, show, text, toastCount } from "./toast-harness";

setupToastHarness();

afterEach(() => {
  delete document.documentElement.dataset.theme;
  setLanguage("en");
  localStorage.clear();
});

it("a success toast shows its title and fades after 4 s", () => {
  mount();
  show(() => notify.success("Saved Lupula.pdf"));
  expect(text()).toContain("Saved Lupula.pdf");

  advance(3900);
  expect(text()).toContain("Saved Lupula.pdf");

  advance(100 + EXIT_MS);
  expect(text()).not.toContain("Saved Lupula.pdf");
});

// The stack is expanded by default, which must not pause the fade timers (only
// hovering the stack does).
it("a success toast still fades in the expanded stack, beside a warning that stays", () => {
  mount();
  show(() => notify.warning("Stays"), () => notify.success("Fades"));
  expect(toastCount()).toBe(2);
  advance(4100 + EXIT_MS);
  expect(text()).not.toContain("Fades");
  expect(text()).toContain("Stays");
  expect(toastCount()).toBe(1);
});

it("warnings and errors stay until dismissed and have a close button", () => {
  mount();
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
  mount();
  show(() => notify.info("Switched to “Lolev”"));

  advance(7900);
  expect(text()).toContain("Switched to “Lolev”");

  advance(100 + EXIT_MS);
  expect(text()).not.toContain("Switched to “Lolev”");
});

it("sits at the bottom centre", () => {
  mount();
  show(() => notify.success("Saved"));
  const toaster = document.querySelector("[data-sonner-toaster]")!;
  expect(toaster.getAttribute("data-y-position")).toBe("bottom");
  expect(toaster.getAttribute("data-x-position")).toBe("center");
});

it("follows the app theme", () => {
  document.documentElement.dataset.theme = "dark";
  mount();
  show(() => notify.success("Saved"));
  expect(document.querySelector("[data-sonner-toaster]")!.getAttribute("data-sonner-theme")).toBe("dark");
});

// Sonner hides the OLDEST toast once more than `visibleToasts` are up. Four is
// what fits the preview pane at the smallest window (see sonner.tsx), so a fifth
// hides the oldest until a newer one closes.
it("keeps four toasts visible and expanded, hides the oldest for a fifth, and brings it back", () => {
  mount();
  const toasts = () => [...document.querySelectorAll("[data-sonner-toast]")];
  const states = (attribute: string) => toasts().map((li) => li.getAttribute(attribute));
  show(...[1, 2, 3, 4].map((n) => () => notify.warning(`Warning ${n}`, { id: `w${n}` })));
  expect(toastCount()).toBe(4);
  expect(states("data-visible")).toEqual(Array(4).fill("true"));
  // Sonner's default stack folds older toasts into slivers behind the newest;
  // each one is readable (and a persistent error is seen) only when expanded.
  expect(states("data-expanded")).toEqual(Array(4).fill("true"));

  show(() => notify.warning("Warning 5", { id: "w5" }));
  expect(toastCount()).toBe(5);
  const hidden = () => toasts().filter((li) => li.getAttribute("data-visible") === "false");
  expect(hidden().map((li) => li.textContent)).toEqual([expect.stringContaining("Warning 1")]);

  // The oldest returns as soon as a newer toast closes.
  show(() => notify.dismiss("w5"));
  settleDismissal();
  expect(toastCount()).toBe(4);
  expect(states("data-visible")).toEqual(Array(4).fill("true"));
  expect(text()).toContain("Warning 1");
});

it("labels the toast region and the close button in the app's language", () => {
  setLanguage("de");
  mount();
  show(() => notify.warning("Warnung"));
  // Exactly the translated word: Sonner appends its hotkey to the label unless
  // told otherwise, which left a trailing space once the hotkey was turned off.
  expect(document.querySelector("section[aria-label]")!.getAttribute("aria-label")).toBe("Benachrichtigungen");
  expect(document.querySelector("[data-close-button]")!.getAttribute("aria-label")).toBe("Schließen");
});

// Sonner's <section aria-live="polite"> already announces every toast that
// lands in it, and it has no per-toast override. Any second live region that
// holds a toast's text (a role="alert" wrapped around an error's title, a
// mirror outside the section) makes a screen reader say it twice.
it("announces each toast's text through exactly one live region, and leaves it readable", () => {
  mount();
  show(
    () => notify.error("Couldn't save Lupula.pdf", { description: "Disk is full" }),
    () => notify.warning("Lupula-mask.pdf wasn't saved", { description: "Export again to save both files." }),
    () => notify.success("Saved Lupula.pdf"),
    () => notify.info("Switched to “Lolev”", { description: "Hidden values were set aside." }),
  );

  const liveRegions = '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"]';
  /** Every live region whose text holds `message`: ancestors and mirrors alike. */
  const announcing = (message: string) =>
    [...document.querySelectorAll(liveRegions)].filter((el) => el.textContent?.includes(message));
  /** The innermost element holding exactly this text. */
  const elementWith = (message: string) => [...document.querySelectorAll("[data-sonner-toast] *")]
    .find((el) => el.children.length === 0 && el.textContent === message)!;

  for (const message of [
    "Couldn't save Lupula.pdf", "Disk is full",
    "Lupula-mask.pdf wasn't saved", "Export again to save both files.",
    "Saved Lupula.pdf",
    "Switched to “Lolev”", "Hidden values were set aside.",
  ]) {
    expect(announcing(message), message).toHaveLength(1);
    // Screen-reader navigation still reaches the toast itself.
    expect(elementWith(message).closest('[aria-hidden="true"]'), message).toBeNull();
  }
  // Errors are polite like the rest: one region, Sonner's own.
  expect(announcing("Couldn't save Lupula.pdf")[0].getAttribute("aria-live")).toBe("polite");
});

// Sonner's default hotkey is Alt+T, which pulls focus into the toast list. On
// macOS, Option+T types "†" in a text field, so it must stay with the field.
it("leaves focus in a text field when Alt+T is pressed while a toast is shown", () => {
  mount(createElement("input", { "aria-label": "Name" }));
  show(() => notify.warning("Stays until closed"));
  const field = document.querySelector<HTMLInputElement>("input")!;
  field.focus();
  expect(document.activeElement).toBe(field);

  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "†", code: "KeyT", altKey: true, bubbles: true }));
  });

  expect(document.activeElement).toBe(field);
});

it("replaces a toast that reuses its id instead of stacking a second", () => {
  mount();
  show(() => notify.warning("First", { id: "tab-1:resolve" }));
  show(() => notify.warning("Second", { id: "tab-1:resolve" }));
  expect(toastCount()).toBe(1);
  expect(text()).toContain("Second");
  expect(text()).not.toContain("First");
});

it("dismisses a toast by id, and runs its action on click", () => {
  mount();
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
  mount();
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
  settleDismissal();
  advance(5000);

  expect(closed).toHaveBeenCalledTimes(1);
  expect(byId).toHaveBeenCalledTimes(1);
  expect(acted).not.toHaveBeenCalled();
  expect(faded).not.toHaveBeenCalled();
});
