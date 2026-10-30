// toast-harness.ts — the shared setup for DOM tests that mount the real
// <Toaster /> (src/components/ui/sonner.tsx) under happy-dom and look at the
// toasts it renders. Sonner defers showing a toast with setTimeout and hides
// one with requestAnimationFrame, so setupToastHarness() fakes both (and Date,
// which its auto-dismiss reads) and every helper here moves that clock inside
// act(). A module that keeps the setTimeout it finds when it loads stays tied
// to the clock faked at that moment: fontkit, which the PDF builders embed
// fonts with, does, and after that test its timers never fire again. A test
// that builds PDFs therefore imports "@/pdf/build" at the top of its file,
// before any test fakes the clock. Call setupToastHarness() once at the top of
// the test file; it registers the beforeEach and afterEach that fake the clock
// and, after each test, retire every toast, unmount what mount() rendered and
// restore real timers.
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";

let host: { container: HTMLDivElement; root: Root } | undefined;

export function setupToastHarness() {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"],
    });
  });

  afterEach(() => {
    // Sonner's store outlives the Toaster and replays what is still active to the
    // next one that mounts, so retire every toast before the next test.
    toast.dismiss();
    act(() => { host?.root.unmount(); });
    host?.container.remove();
    host = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
  });
}

/** Sonner keeps a dismissed toast mounted for its exit animation (~200 ms). */
export const EXIT_MS = 500;

/** Let time pass inside act so Sonner's timers and state updates flush. */
export function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

/** Render `ui` beside the toaster; call again to rerender or, with nothing, to
 *  unmount what it showed. Sonner needs the toaster mounted before the first
 *  message. A toast an effect shows on the way gets its deferred render. */
export function mount(ui: ReactNode = null) {
  if (!host) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    host = { container, root: createRoot(container) };
  }
  const { root } = host;
  act(() => { root.render(createElement(Fragment, null, createElement(Toaster), ui)); });
  advance(0);
}

/** Run calls (notify, a hook's controls), then let Sonner's deferred render of
 *  them happen. */
export function show(...calls: Array<() => unknown>) {
  act(() => {
    for (const call of calls) call();
    vi.advanceTimersByTime(0);
  });
}

/** Let a dismissal finish. Sonner marks a dismissed toast deleted a couple of
 *  animation frames later and starts its ~200 ms exit timer only once React
 *  has rendered that, so time has to pass twice. */
export function settleDismissal() {
  advance(EXIT_MS);
  advance(EXIT_MS);
}

export const toastCount = () => document.querySelectorAll("[data-sonner-toast]").length;
export const text = () => document.body.textContent ?? "";
