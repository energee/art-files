// @vitest-environment happy-dom
// commandmenu-dom.test.tsx — ⌘K palette rows keep their shortcut hints flush right;
// ⌘K never stacks the palette on top of another modal dialog (#237).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandMenu, shortcutOf } from "@/components/CommandMenu";

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
  // The palette body loads on the first ⌘K (#410).
  await vi.waitFor(() => expect(document.querySelector("[data-slot=command-item]")).not.toBeNull(), { timeout: 5000 });

  // CommandItem appends an invisible (opacity-0) ml-auto CheckIcon that is only
  // display:none when the row has a [data-slot=command-shortcut]. A plain span
  // leaves two auto margins splitting the free space, parking the hint mid-row
  // at an x that depends on the label's length (#133).
  const items = [...document.querySelectorAll("[data-slot=command-item]")];
  const withKey = items.find((el) => el.textContent?.startsWith("New Tab"));
  const shortcut = withKey?.querySelector("[data-slot=command-shortcut]");
  expect(shortcut?.textContent).toBe("Ctrl+N");
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
    await vi.waitFor(() => expect(palette()).not.toBeNull(), { timeout: 5000 });
    const input = document.querySelector("[data-slot=command-input]") as HTMLInputElement;
    expect(input.closest('[data-slot="dialog-content"]')).not.toBeNull();
    await pressK(input);
    expect(palette()).toBeNull();
  });
});

it("formats modified shortcuts for both platforms (#320)", () => {
  const cmd = { id: "save", label: "Save As", run: () => {}, key: "s", mods: "⇧⌘" as const };
  expect(shortcutOf(cmd, true)).toBe("⇧⌘S");
  expect(shortcutOf(cmd, false)).toBe("Ctrl+Shift+S");
});

it("lists a command no menu names in the trailing Other group, under its own label", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(CommandMenu, { actions: [
      { id: "variant-new", label: "New Variant", run: () => undefined },
    ] }));
  });
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  });
  await vi.waitFor(() => expect(document.querySelector("[data-slot=command-item]")).not.toBeNull(), { timeout: 5000 });
  const group = document.querySelector("[data-slot=command-group]")!;
  expect(group.querySelector("[cmdk-group-heading]")?.textContent).toBe("Other");
  expect(group.querySelector("[data-slot=command-item]")?.textContent).toBe("New Variant");
  await act(async () => root.unmount());
  container.remove();
});
