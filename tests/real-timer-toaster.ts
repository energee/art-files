// real-timer-toaster.ts — the real <Toaster /> (src/components/ui/sonner.tsx)
// for DOM suites that run an editor on real timers; tests/toast-harness.ts is
// its sibling for suites that fake the clock. Call mountToaster() before the
// editor sends its first message (Sonner needs the toaster mounted), and
// unmountToaster() when the test ends. A toast lands a tick after its message
// is sent, so use shown() to wait for one. To check that a toast did NOT land
// (or was not dismissed), first await the event that would have caused it (an
// open or a decode settling, a write finishing), then settle() so the toast
// has the tick Sonner needs to appear; settle() alone proves nothing unless
// there is no such event to await. A toast that should still be up is checked
// with removedFlags() too, not only by its title.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { expect, vi } from "vitest";
import { Toaster } from "../src/components/ui/sonner";

let host: { container: HTMLDivElement; root: Root } | undefined;

export async function mountToaster() {
  const container = document.body.appendChild(document.createElement("div"));
  host = { container, root: createRoot(container) };
  await act(async () => host!.root.render(createElement(Toaster)));
}

export async function unmountToaster() {
  // Sonner's store outlives the Toaster and replays what is still active to the
  // next one that mounts, so retire every toast before the next test.
  toast.dismiss();
  await act(async () => host?.root.unmount());
  host?.container.remove();
  host = undefined;
}

/** Wait until `message` is on screen. DOM updates land when an act() settles,
 *  so each poll flushes one. */
export const shown = (message: string) => vi.waitFor(async () => {
  await act(async () => {});
  expect(document.body.textContent).toContain(message);
}, { timeout: 15000 });

/** One tick for Sonner to render a toast sent, or flag one dismissed, just
 *  before (it defers both). Not a substitute for awaiting the event itself. */
export const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });

export const toastTitles = () =>
  [...document.querySelectorAll("[data-sonner-toast] [data-title]")].map((el) => el.textContent);

/** Sonner flags a dismissed toast (data-removed="true") a couple of frames
 *  after the dismissal but keeps it in the DOM for its ~200 ms exit, so a toast
 *  that is leaving still shows in toastTitles(). A toast that should still be
 *  up reads "false" here. */
export const removedFlags = () =>
  [...document.querySelectorAll("[data-sonner-toast]")].map((el) => el.getAttribute("data-removed"));

/** What the editor's header still shows as a message: the alerts, blocked pill
 *  and warning text it used to carry. Every message is a toast now, so none. */
export const headerMessages = () =>
  document.querySelectorAll('header [role="alert"], header [data-blocked-export], header .text-warning-text');
