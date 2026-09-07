// @vitest-environment happy-dom
// appmenu-dom.test.tsx — the in-window File menu paints a leading icon on each action.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { APP_MENUS, AppMenu, actionsIn } from "@/components/AppMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("renders a leading svg on File → New Tab", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(AppMenu, {
        actions: actionsIn(APP_MENUS).map((entry) => ({
          id: entry.id, label: entry.text, run: () => undefined,
        })),
        checked: {},
        onNativeError: () => undefined,
        onCheckForUpdates: () => undefined,
      }));
    });
    const file = [...container.querySelectorAll("[data-slot=menubar-trigger]")]
      .find((el) => el.textContent === "File");
    if (!(file instanceof HTMLElement)) throw new Error("File trigger missing");
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        file.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      }
      file.click();
      await Promise.resolve();
    });
    const newTab = [...document.querySelectorAll("[role=menuitem]")]
      .find((el) => el.textContent?.includes("New Tab"));
    if (!(newTab instanceof HTMLElement)) throw new Error("New Tab item missing");
    const glyph = newTab.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(newTab.firstElementChild).toBe(glyph);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
