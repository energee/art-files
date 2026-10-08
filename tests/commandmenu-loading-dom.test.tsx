// @vitest-environment happy-dom
// commandmenu-loading-dom.test.tsx — the ⌘K palette loads on first use (#410).
// A ⌘K that another dialog blocks must not fetch it, and while it loads the
// tab's keys must already be blocked (dialogOpen), as they are once it shows.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { dialogOpen } from "@/keys";

const probe = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { imports: 0, gate, release };
});
// The factory runs on the first import and holds the chunk until released.
vi.mock("@/components/CommandPalette", async () => {
  probe.imports++;
  await probe.gate;
  const { createElement: h } = await import("react");
  return { CommandPalette: (p: { open: boolean }) => p.open ? h("div", { "data-testid": "palette" }) : null };
});
import { CommandMenu } from "@/components/CommandMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("a blocked ⌘K fetches nothing; a loading palette already blocks the tab's keys", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const pressK = () => act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  });
  await act(async () => root.render(createElement(CommandMenu, { actions: [] })));
  try {
    const other = document.createElement("div");
    other.setAttribute("data-slot", "dialog-content");
    document.body.append(other);
    await pressK();
    expect(probe.imports).toBe(0);
    other.remove();

    await pressK();
    await vi.waitFor(() => expect(probe.imports).toBe(1));
    expect(document.querySelector("[data-testid=palette]")).toBeNull();
    expect(dialogOpen()).toBe(true);

    await act(async () => { probe.release(); await probe.gate; });
    await vi.waitFor(() => expect(document.querySelector("[data-testid=palette]")).not.toBeNull());
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
