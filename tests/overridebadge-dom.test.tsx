// overridebadge-dom.test.tsx — DOM behavior of OverrideBadge
// (src/components/StyleProperties.tsx): the small dot + reset button the
// inspector's Style controls show beside a property the current variant
// overrides (Task 3). Mounted directly rather than through the whole
// Inspector — OverrideBadge is a self-contained four-prop component, so no
// stub plumbing for `files`/`settings`/`fields`/`update` etc. is needed.
// Scoped to a DOM environment per-file and driven through
// react-dom/client + act, matching tests/editingtarget-dom.test.tsx's
// convention (see its header) — no @testing-library/react in this repo.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverrideBadge } from "../src/components/StyleProperties";

// React only honours act() when the environment opts in (see
// tests/editingtarget-dom.test.tsx for the same line).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function renderBadge(props: Partial<Parameters<typeof OverrideBadge>[0]> = {}) {
  const full: Parameters<typeof OverrideBadge>[0] = {
    path: "nameStyle.fill",
    overridden: new Set(["nameStyle.fill"]),
    label: "Fill",
    onReset: vi.fn(),
    ...props,
  };
  act(() => { root.render(createElement(OverrideBadge, full)); });
  return full;
}

const button = () => container.querySelector("button");

describe("OverrideBadge", () => {
  it("renders nothing when path is null (not derivable — e.g. a custom layer)", () => {
    renderBadge({ path: null });
    expect(button()).toBeNull();
  });

  it("renders nothing when the path is not in the overridden set", () => {
    renderBadge({ path: "nameStyle.fill", overridden: new Set(["abv"]) });
    expect(button()).toBeNull();
  });

  it("renders the dot when the path IS in the overridden set", () => {
    renderBadge({ path: "nameStyle.fill", overridden: new Set(["nameStyle.fill"]) });
    expect(button()).not.toBeNull();
  });

  it("labels the reset button exactly \"Reset ${label} to the master\"", () => {
    renderBadge({ label: "Letter Spacing", path: "storeCold.letterSpacing",
      overridden: new Set(["storeCold.letterSpacing"]) });
    expect(button()!.getAttribute("aria-label")).toBe("Reset Letter Spacing to the master");
  });

  it("clicking it calls onReset with exactly that path", () => {
    const onReset = vi.fn();
    renderBadge({ path: "barcodeStrokeWidth",
      overridden: new Set(["barcodeStrokeWidth"]), onReset });
    act(() => { button()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledWith("barcodeStrokeWidth");
  });
});
