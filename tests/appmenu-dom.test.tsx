// @vitest-environment happy-dom
// appmenu-dom.test.tsx — the in-window menu draws text rows without icons.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { APP_MENUS, AppMenu, actionsIn } from "@/components/AppMenu";
import { setViewport } from "./viewport";

afterEach(() => { setViewport(1024, 768); });

/** `checked` and `disabled` (command ids) set row state, for parity checks. */
async function renderMenu(checked: Record<string, boolean> = {}, disabled: readonly string[] = []) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AppMenu, {
      actions: actionsIn(APP_MENUS).map((entry) => ({
        id: entry.id, label: entry.text, run: () => undefined, disabled: disabled.includes(entry.id),
      })),
      checked,
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
  await press(trigger);
}

async function press(el: HTMLElement) {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    }
    el.click();
    await Promise.resolve();
  });
}

function menuItem(label: string) {
  const item = [...document.querySelectorAll("[role=menuitem], [role=menuitemcheckbox]")]
    .find((el) => el.textContent?.includes(label));
  if (!(item instanceof HTMLElement)) throw new Error(`${label} item missing`);
  return item;
}

it("draws no icon on a row: only the text, shortcut and checkmark", async () => {
  const { container, root } = await renderMenu();
  try {
    await openMenu(container, "File");
    expect(menuItem("New Tab").querySelector("svg")).toBeNull();
    // Close File first: clicking another trigger while a menu is open closes it
    // rather than switching (same in Chrome on Base UI 1.6 and 1.8).
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    await openMenu(container, "View");
    expect(menuItem("Label").querySelector("svg.lucide-rectangle-horizontal")).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

const escape = () => act(async () => {
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await Promise.resolve();
});
const subTrigger = (name: string) => [...document.querySelectorAll("[data-slot=menubar-sub-trigger]")]
  .find((el) => el.textContent === name) as HTMLElement;

it("folds File, Edit, Layer and View into one ☰ menu on a phone", async () => {
  const props = [{ "view-label": true }, ["redo"]] as const;
  const desktop = await renderMenu(...props);
  const titles = [...desktop.container.querySelectorAll("[data-slot=menubar-trigger]")].map((el) => el.textContent);
  expect(titles).toEqual(["File", "Edit", "Layer", "View"]);
  await openMenu(desktop.container, "Edit");
  const redoDisabled = menuItem("Redo").hasAttribute("data-disabled");
  await escape();
  await openMenu(desktop.container, "View");
  const desktopState = { labelChecked: menuItem("Label").getAttribute("aria-checked"), redoDisabled };
  expect(desktopState).toEqual({ labelChecked: "true", redoDisabled: true });
  await act(async () => { desktop.root.unmount(); });
  desktop.container.remove();

  setViewport(390, 844);
  const { container, root } = await renderMenu(...props);
  try {
    expect(container.querySelectorAll("[data-slot=menubar-trigger]")).toHaveLength(1);
    await openMenu(container, "Menu");
    const subs = [...document.querySelectorAll("[data-slot=menubar-sub-trigger]")];
    expect(subs.map((el) => el.textContent)).toEqual(titles);
    await press(subTrigger("Edit"));
    expect(menuItem("Undo")).toBeTruthy();
    const phoneRedoDisabled = menuItem("Redo").hasAttribute("data-disabled");
    await press(subTrigger("View"));
    expect({ labelChecked: menuItem("Label").getAttribute("aria-checked"), redoDisabled: phoneRedoDisabled })
      .toEqual(desktopState);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("sizes the ☰ glyph like the menu rows' glyphs", async () => {
  setViewport(390, 844);
  const { container, root } = await renderMenu();
  try {
    const glyph = container.querySelector("[data-slot=menubar-trigger] svg");
    expect(glyph?.classList.contains("size-4")).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("Escape closes ☰ and returns focus to it", async () => {
  setViewport(390, 844);
  const { container, root } = await renderMenu();
  try {
    const trigger = container.querySelector("[data-slot=menubar-trigger]") as HTMLElement;
    await openMenu(container, "Menu");
    expect(document.querySelector("[data-slot=menubar-content]")).not.toBeNull();
    await escape();
    expect(document.querySelector("[data-slot=menubar-content]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
