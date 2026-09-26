// keys.test.ts — keyOwner, the one key-ownership classifier (#225), and
// dialogOpen, which blocks the ⌘ commands behind a modal dialog (#244).
// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { dialogOpen, keyOwner } from "../src/keys";

afterEach(() => { document.body.replaceChildren(); });

/** Build `html` in the body and return the element marked `data-t`. */
const at = (html: string): Element => {
  document.body.innerHTML = html;
  return document.querySelector("[data-t]")!;
};

it("a text field or contenteditable is text, even inside a popup or the inspector", () => {
  expect(keyOwner(at('<input data-t>'))).toBe("text");
  expect(keyOwner(at('<div role="dialog"><textarea data-t></textarea></div>'))).toBe("text");
  expect(keyOwner(at('<div role="dialog" data-slot="dialog-content"><select data-t></select></div>'))).toBe("text");
  const editable = at('<div contenteditable="true" data-t></div>') as HTMLElement;
  // happy-dom does not derive isContentEditable from the attribute.
  Object.defineProperty(editable, "isContentEditable", { value: true });
  expect(keyOwner(editable)).toBe("text");
});

it("anything inside a dialog, menu or list is the popup's", () => {
  for (const role of ["dialog", "alertdialog", "listbox", "menu", "combobox"]) {
    expect(keyOwner(at(`<div role="${role}"><button data-t></button></div>`))).toBe("popup");
  }
  expect(keyOwner(at('<div role="dialog"><div role="radiogroup"><button data-t></button></div></div>'))).toBe("popup");
});

it("a modal dialog (shadcn DialogContent) is a dialog, not just a popup", () => {
  expect(keyOwner(at('<div role="dialog" data-slot="dialog-content"><button data-t></button></div>'))).toBe("dialog");
  expect(keyOwner(at('<div role="dialog" data-slot="popover-content"><button data-t></button></div>'))).toBe("popup");
  expect(keyOwner(at('<div role="dialog" data-slot="sheet-content"><button data-t></button></div>'))).toBe("popup");
});

it("a roving-focus widget owns only its arrows", () => {
  for (const attr of ['role="radiogroup"', 'role="tablist"', 'role="slider"', 'data-slot="toggle-group"']) {
    expect(keyOwner(at(`<div ${attr}><button data-t></button></div>`))).toBe("widget");
  }
});

it("everything else, and no target, is the app's", () => {
  expect(keyOwner(at('<button data-t></button>'))).toBeNull();
  expect(keyOwner(document.body)).toBeNull();
  expect(keyOwner(null)).toBeNull();
  expect(keyOwner(window)).toBeNull();
});

it("dialogOpen sees a modal dialog anywhere, but not a popover or the inspector", () => {
  document.body.innerHTML = '<div role="dialog" data-slot="popover-content"></div><div role="dialog" data-slot="sheet-content"></div>';
  expect(dialogOpen()).toBe(false);
  document.body.insertAdjacentHTML("beforeend", '<div role="dialog" data-slot="dialog-content"></div>');
  expect(dialogOpen()).toBe(true);
  document.querySelector('[data-slot="dialog-content"]')!.setAttribute("data-closed", "");
  expect(dialogOpen()).toBe(false); // animating out after Escape
});
