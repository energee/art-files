// use-owned-toast-dom.test.tsx — useOwnedToast (src/useOwnedToast.ts), the hook
// for a message that belongs to one source and one tab: a writer replaces or
// clears only its own toast (#473 exports, #511 asset assembly), the toast
// hides while its tab is inactive and comes back with the tab (unless the user
// closed it), a message that arrives right after a dismissal still shows, and
// the toast goes when the owner unmounts. The real <Toaster /> is mounted under
// happy-dom with Sonner's timers faked (see tests/toaster-dom.test.tsx for
// why), and each owner is a tiny component that hands the hook's controls to
// the test.
// @vitest-environment happy-dom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { useOwnedToast } from "@/useOwnedToast";

type Owned = ReturnType<typeof useOwnedToast>;

let container: HTMLDivElement;
let root: Root;

/** Renders nothing; passes the hook's controls to `into` for the test to call. */
function Owner({ active = true, into }: { active?: boolean; into: (owned: Owned) => void }) {
  const owned = useOwnedToast(active);
  useEffect(() => { into(owned); }, [into, owned]);
  return null;
}

/** Let time pass inside act so Sonner's timers and state updates flush. */
function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

/** Render the toaster plus these owners; call again to rerender or unmount
 *  them. A toast an owner's effect shows on the way gets its deferred render. */
function mount(owners: ReactNode = null) {
  act(() => { root.render(<><Toaster />{owners}</>); });
  advance(0);
}

/** Run owner calls, then let Sonner's deferred render of them happen. */
function show(...calls: Array<() => void>) {
  act(() => {
    for (const call of calls) call();
    vi.advanceTimersByTime(0);
  });
}

/** Sonner keeps a dismissed toast mounted for its exit animation (~200 ms). */
const EXIT_MS = 500;

/** Let a dismissal finish. Sonner marks a dismissed toast deleted a couple of
 *  animation frames later and starts its ~200 ms exit timer only once React
 *  has rendered that, so time has to pass twice. */
function settleDismissal() {
  advance(EXIT_MS);
  advance(EXIT_MS);
}

const toastCount = () => document.querySelectorAll("[data-sonner-toast]").length;
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  // Sonner's store outlives the Toaster and replays what is still active to the
  // next one that mounts, so retire every toast before the next test.
  toast.dismiss();
  act(() => { root.unmount(); });
  container.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("shows its message and replaces it instead of stacking", () => {
  let owned!: Owned;
  mount(<Owner into={(o) => { owned = o; }} />);

  show(() => owned.set("Export A failed"));
  show(() => owned.set("Export B failed"));

  expect(toastCount()).toBe(1);
  expect(text()).toContain("Export B failed");
  expect(text()).not.toContain("Export A failed");
});

it("clear dismisses only its own toast (#473, #511)", () => {
  let exports!: Owned;
  let assets!: Owned;
  mount(<><Owner into={(o) => { exports = o; }} /><Owner into={(o) => { assets = o; }} /></>);

  show(() => exports.set("Export failed"), () => assets.set("Asset assembly failed"));
  expect(toastCount()).toBe(2);

  act(() => { assets.clear(); });
  settleDismissal();

  expect(text()).toContain("Export failed");
  expect(text()).not.toContain("Asset assembly failed");
});

it("hides while its tab is inactive and returns with the tab", () => {
  let owned!: Owned;
  const into = (o: Owned) => { owned = o; };
  mount(<Owner active into={into} />);
  show(() => owned.set("Export failed"));
  expect(text()).toContain("Export failed");

  mount(<Owner active={false} into={into} />);
  settleDismissal();
  expect(text()).not.toContain("Export failed");

  mount(<Owner active into={into} />);
  expect(text()).toContain("Export failed");
});

it("a message set while its tab is inactive waits for the tab", () => {
  let owned!: Owned;
  const into = (o: Owned) => { owned = o; };
  mount(<Owner active={false} into={into} />);

  show(() => owned.set("Export failed"));
  expect(text()).not.toContain("Export failed");

  mount(<Owner active into={into} />);
  expect(text()).toContain("Export failed");
});

it("a message cleared while its tab is inactive does not return with the tab", () => {
  let owned!: Owned;
  const into = (o: Owned) => { owned = o; };
  mount(<Owner active into={into} />);
  show(() => owned.set("Export failed"));
  mount(<Owner active={false} into={into} />);

  act(() => { owned.clear(); });
  mount(<Owner active into={into} />);
  settleDismissal();

  expect(toastCount()).toBe(0);
});

it("stays until cleared", () => {
  let owned!: Owned;
  mount(<Owner into={(o) => { owned = o; }} />);
  show(() => owned.set("Export failed"));

  advance(60_000);
  expect(text()).toContain("Export failed");
});

it("unmounting the owner dismisses its toast", () => {
  let owned!: Owned;
  mount(<Owner into={(o) => { owned = o; }} />);
  show(() => owned.set("Export failed"));
  expect(text()).toContain("Export failed");

  mount();
  settleDismissal();
  expect(text()).not.toContain("Export failed");
});

it("is an error unless told it is a warning, and carries its description and action", () => {
  let owned!: Owned;
  mount(<Owner into={(o) => { owned = o; }} />);
  const onClick = vi.fn();

  show(() => owned.set("Export failed"));
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("error");

  show(() => owned.set("Mask not saved", "warning", { description: "Disk is full", action: { label: "Retry", onClick } }));
  expect(toastCount()).toBe(1);
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("warning");
  expect(text()).toContain("Disk is full");

  act(() => { [...document.querySelectorAll("button")].find((b) => b.textContent === "Retry")!.click(); });
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("set after unmount shows nothing", () => {
  let owned!: Owned;
  mount(<Owner into={(o) => { owned = o; }} />);
  show(() => owned.set("Export failed"));
  mount();
  settleDismissal();

  show(() => owned.set("Render failed after the label was closed"));
  advance(60_000);

  expect(toastCount()).toBe(0);
});

// Sonner keeps a dismissed toast's entry for ~250 ms and folds a toast shown
// with the same id into it, so the new toast would vanish with the old one.
it("a message set right after clear still shows", () => {
  let owned!: Owned;
  mount(<Owner into={(o) => { owned = o; }} />);
  show(() => owned.set("Export failed"));

  act(() => { owned.clear(); });
  advance(50);
  show(() => owned.set("Export failed again"));
  settleDismissal();

  expect(toastCount()).toBe(1);
  expect(text()).toContain("Export failed again");
});

it("a tab that is left and re-entered at once still shows its message", () => {
  let owned!: Owned;
  const into = (o: Owned) => { owned = o; };
  mount(<Owner active into={into} />);
  show(() => owned.set("Export failed"));

  mount(<Owner active={false} into={into} />);
  advance(50);
  mount(<Owner active into={into} />);
  settleDismissal();

  expect(toastCount()).toBe(1);
  expect(text()).toContain("Export failed");
});

it("a toast the user closes stays closed when the tab returns", () => {
  let owned!: Owned;
  const into = (o: Owned) => { owned = o; };
  mount(<Owner active into={into} />);
  show(() => owned.set("Export failed"));

  act(() => { document.querySelector<HTMLButtonElement>("[data-close-button]")!.click(); });
  settleDismissal();
  mount(<Owner active={false} into={into} />);
  mount(<Owner active into={into} />);
  settleDismissal();

  expect(toastCount()).toBe(0);
});

it("a toast whose action was clicked stays closed, and the action can set a new message", () => {
  let owned!: Owned;
  const into = (o: Owned) => { owned = o; };
  const retry = vi.fn(() => owned.set("Retry failed"));
  mount(<Owner active into={into} />);
  show(() => owned.set("Export failed", "error", { action: { label: "Retry", onClick: retry } }));

  act(() => { [...document.querySelectorAll("button")].find((b) => b.textContent === "Retry")!.click(); });
  settleDismissal();
  expect(retry).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Retry failed");
  expect(text()).not.toContain("Export failed");

  // Only the message the action set is remembered, not the one it was clicked on.
  mount(<Owner active={false} into={into} />);
  mount(<Owner active into={into} />);
  settleDismissal();
  expect(toastCount()).toBe(1);
  expect(text()).toContain("Retry failed");
});

// Sonner folds a toast shown under an id that is already on screen into it, so
// anything the new message does not set would otherwise be kept from the old one.
it("replacing a message drops the old one's description and action", () => {
  let owned!: Owned;
  mount(<Owner into={(o) => { owned = o; }} />);
  show(() => owned.set("Mask not saved", "warning", { description: "Disk is full", action: { label: "Retry", onClick: vi.fn() } }));

  show(() => owned.set("Export failed"));

  expect(text()).toContain("Export failed");
  expect(text()).not.toContain("Disk is full");
  expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Retry")).toBe(false);
});
