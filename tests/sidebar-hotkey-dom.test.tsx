// sidebar-hotkey-dom.test.tsx — the ⌘B sidebar toggle stands aside only for
// a text field (where ⌘B is bold) or a modal dialog, like the app's other ⌘
// shortcuts: the inspector Sheet and a Select still toggle it.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SidebarProvider } from "../src/components/ui/sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let open: boolean;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  open = true;
  const render = () => root.render(createElement(SidebarProvider, {
    open, onOpenChange: (next: boolean) => { open = next; render(); },
  }));
  act(render);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function pressCmdB(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
  });
}

function inside(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.querySelector("[data-target]") as HTMLElement;
}

it("⌘B toggles from inside the inspector Sheet", () => {
  pressCmdB(inside('<div role="dialog"><button data-target>x</button></div>'));
  expect(open).toBe(false);
});

it("⌘B toggles from a focused Select", () => {
  pressCmdB(inside('<button role="combobox" data-target>x</button>'));
  expect(open).toBe(false);
});

it("⌘B stays with a text field and a modal dialog", () => {
  pressCmdB(inside('<input data-target>'));
  pressCmdB(inside('<div data-slot="dialog-content"><button data-target>x</button></div>'));
  expect(open).toBe(true);
});
