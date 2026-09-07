// @vitest-environment happy-dom
// appmenu-dom.test.tsx — the in-window File menu paints a leading icon on each action.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { APP_MENUS, AppMenu } from "@/components/AppMenu";
import type { Command } from "@/components/CommandMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubCommands(entries: typeof APP_MENUS[number]["items"]): Command[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "action") {
      return [{ id: entry.id, label: entry.text, run: () => undefined }];
    }
    return entry.kind === "submenu" ? stubCommands(entry.items) : [];
  });
}

it("renders a leading svg on File → New Tab", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(AppMenu, {
        actions: APP_MENUS.flatMap((menu) => stubCommands(menu.items)),
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
