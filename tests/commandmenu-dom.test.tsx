// @vitest-environment happy-dom
// commandmenu-dom.test.tsx — ⌘K palette rows keep their shortcut hints flush right;
// ⌘K never stacks the palette on top of another modal dialog (#237).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandMenu } from "@/components/CommandMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;

it("renders each shortcut as the command-shortcut slot, so the row's spare check icon steps aside", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(CommandMenu, { actions: [
      { id: "new", label: "New Tab", run: () => undefined, key: "n", mods: "⌘" },
      { id: "plain", label: "Show Guides", run: () => undefined },
    ] }));
  });
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  });

  // CommandItem appends an invisible (opacity-0) ml-auto CheckIcon that is only
  // display:none when the row has a [data-slot=command-shortcut]. A plain span
  // leaves two auto margins splitting the free space, parking the hint mid-row
  // at an x that depends on the label's length (#133).
  const items = [...document.querySelectorAll("[data-slot=command-item]")];
  const withKey = items.find((el) => el.textContent?.startsWith("New Tab"));
  const shortcut = withKey?.querySelector("[data-slot=command-shortcut]");
  expect(shortcut?.textContent).toBe("⌘N");
  const plain = items.find((el) => el.textContent === "Show Guides");
  expect(plain?.querySelector("[data-slot=command-shortcut]")).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

describe("⌘K over an open dialog (#237)", () => {
  let root: Root;
  beforeEach(async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(CommandMenu, { actions: [{ id: "a", label: "Show Guides", run: () => undefined }] }));
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  const palette = () => document.querySelector("[data-slot=command]");
  const pressK = (target: EventTarget) => act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
  });
  /** A focused control inside an open modal dialog's DialogContent. */
  const focusedInDialog = (tag: "button" | "input") => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-slot", "dialog-content");
    const el = document.createElement(tag);
    dialog.append(el);
    document.body.append(dialog);
    el.focus();
    return el;
  };

  it("⌘K inside another open dialog does not open the palette over it", async () => {
    await pressK(focusedInDialog("button"));
    expect(palette()).toBeNull();
    // keyOwner reports a field in a dialog as "text"; the dialog still owns ⌘K.
    await pressK(focusedInDialog("input"));
    expect(palette()).toBeNull();
  });

  it("⌘K opens the palette from the app, and ⌘K inside the palette closes it", async () => {
    await pressK(document.body);
    expect(palette()).not.toBeNull();
    const input = document.querySelector("[data-slot=command-input]") as HTMLInputElement;
    expect(input.closest('[data-slot="dialog-content"]')).not.toBeNull();
    await pressK(input);
    expect(palette()).toBeNull();
  });
});
