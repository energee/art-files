// dropdown-submenu-dom.test.tsx — where a submenu goes when it does not fit.
// On a phone a submenu keeps its side and slides back on screen (the ☰ View
// menu, too tall for Base UI's fallback, otherwise hung off the right edge).
// On a desktop Base UI's default stays: a submenu with no room on the right,
// such as the inspector's Bind to layer… menu at the window's edge, flips left.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setViewport } from "./viewport";

// What each menu Positioner was given: the submenu's is the one on the right.
const seen: { side?: string; collisionAvoidance?: unknown }[] = [];
vi.mock("@base-ui/react/menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@base-ui/react/menu")>();
  const Positioner = (props: { side?: string; collisionAvoidance?: unknown }) => {
    seen.push({ side: props.side, collisionAvoidance: props.collisionAvoidance });
    return createElement(actual.Menu.Positioner, props as never);
  };
  return { ...actual, Menu: { ...actual.Menu, Positioner } };
});
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "../src/components/ui/dropdown-menu";

afterEach(() => { seen.length = 0; setViewport(1024, 768); });

const render = (width: number, height: number) => {
  setViewport(width, height);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(DropdownMenu, { open: true },
      createElement(DropdownMenuContent, null,
        createElement(DropdownMenuSub, { open: true },
          createElement(DropdownMenuSubTrigger, null, "Bind"),
          createElement(DropdownMenuSubContent, null, createElement(DropdownMenuItem, null, "top"))))));
  });
  act(() => { root.unmount(); });
  container.remove();
  return seen.filter((p) => p.side === "right");
};

it("shifts a submenu back on screen on a phone", () => {
  const sub = render(390, 844);
  expect(sub.length).toBeGreaterThan(0);
  expect(sub.at(-1)!.collisionAvoidance).toEqual({ side: "shift" });
});

it("leaves a desktop submenu to Base UI's default, which flips it", () => {
  const sub = render(1280, 800);
  expect(sub.length).toBeGreaterThan(0);
  expect(sub.at(-1)!.collisionAvoidance).toBeUndefined();
});
