// @vitest-environment happy-dom
// appmenu-dom.test.tsx — the in-window menu paints a glyph only where the Mac menu does.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { APP_MENUS, AppMenu, actionsIn } from "@/components/AppMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderMenu() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
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
  return { container, root };
}

async function openMenu(container: HTMLElement, name: string) {
  const trigger = [...container.querySelectorAll("[data-slot=menubar-trigger]")]
    .find((el) => el.textContent === name);
  if (!(trigger instanceof HTMLElement)) throw new Error(`${name} trigger missing`);
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    }
    trigger.click();
    await Promise.resolve();
  });
}

function menuItem(label: string) {
  const item = [...document.querySelectorAll("[role=menuitem], [role=menuitemcheckbox]")]
    .find((el) => el.textContent?.includes(label));
  if (!(item instanceof HTMLElement)) throw new Error(`${label} item missing`);
  return item;
}

it("renders a leading svg on File → New Tab", async () => {
  const { container, root } = await renderMenu();
  try {
    await openMenu(container, "File");
    const newTab = menuItem("New Tab");
    const glyph = newTab.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(newTab.firstElementChild).toBe(glyph);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("renders a leading svg on Edit → Undo and none on View → Label", async () => {
  const { container, root } = await renderMenu();
  try {
    await openMenu(container, "Edit");
    const undo = menuItem("Undo");
    expect(undo.querySelector("svg")).not.toBeNull();
    // Close Edit first: clicking another trigger while a menu is open closes it
    // rather than switching (same in Chrome on Base UI 1.6 and 1.8).
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    await openMenu(container, "View");
    const label = menuItem("Label");
    expect(label.querySelector("svg")).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
