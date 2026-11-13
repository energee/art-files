// @vitest-environment happy-dom
// appmenu-dom.test.tsx — the in-window menu paints a glyph only where the Mac menu does.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { APP_MENUS, AppMenu, actionsIn } from "@/components/AppMenu";
import { setViewport } from "./viewport";

afterEach(() => { setViewport(1024, 768); });

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

it("renders a leading svg on Edit → Undo and on the View → Label check", async () => {
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
    // Its own glyph, not only the checkmark indicator.
    expect(label.querySelector("svg.lucide-rectangle-horizontal")).not.toBeNull();
    // Sized like a plain row's glyph: the checkbox item has no svg size rule
    // of its own, so an unsized Lucide icon drew at its 24px default.
    expect(label.querySelector("svg.lucide-rectangle-horizontal")?.classList.contains("size-4")).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("folds File, Edit, Layer and View into one ☰ menu on a phone", async () => {
  const desktop = await renderMenu();
  const titles = [...desktop.container.querySelectorAll("[data-slot=menubar-trigger]")].map((el) => el.textContent);
  expect(titles).toEqual(["File", "Edit", "Layer", "View"]);
  await act(async () => { desktop.root.unmount(); });
  desktop.container.remove();

  setViewport(390, 844);
  const { container, root } = await renderMenu();
  try {
    expect(container.querySelectorAll("[data-slot=menubar-trigger]")).toHaveLength(1);
    await openMenu(container, "Menu");
    const subs = [...document.querySelectorAll("[data-slot=menubar-sub-trigger]")];
    expect(subs.map((el) => el.textContent)).toEqual(titles);
    await press(subs.find((el) => el.textContent === "Edit") as HTMLElement);
    expect(menuItem("Undo")).toBeTruthy();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
