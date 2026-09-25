// @vitest-environment happy-dom
// commandmenu-dom.test.tsx — ⌘K palette rows keep their shortcut hints flush right.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
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
