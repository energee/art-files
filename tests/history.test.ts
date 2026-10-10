// history.test.ts — the undo/redo stack transitions behind useHistory, and
// the hook's step grouping (mounted through react-dom/client + act).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { pushed, redone, resetTo, undone, useHistory, type Stacks } from "../src/history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("history stacks", () => {
  it("undo returns the previous value and redo puts it back", () => {
    let s = pushed(resetTo("a"), "b", false);
    s = pushed(s, "c", false);
    s = undone(s);
    expect(s.present).toBe("b");
    s = undone(s);
    expect(s.present).toBe("a");
    expect(undone(s).present).toBe("a"); // nothing left to undo
    s = redone(redone(s));
    expect(s.present).toBe("c");
    expect(redone(s).present).toBe("c"); // nothing left to redo
  });

  it("coalesced edits collapse into one undo step", () => {
    let s: Stacks<number> = resetTo(0);
    for (let i = 1; i <= 20; i++) s = pushed(s, i, i > 1);
    expect(s.present).toBe(20);
    expect(undone(s).present).toBe(0);
  });

  it("a new edit clears the redo stack", () => {
    let s = undone(pushed(resetTo("a"), "b", false));
    s = pushed(s, "c", false);
    expect(s.future).toEqual([]);
    expect(undone(s).present).toBe("a");
  });

  it("ignores a no-op set", () => {
    const s = resetTo("a");
    expect(pushed(s, "a", false)).toBe(s);
  });

  it("resets both stacks at a new project boundary", () => {
    expect(resetTo("new")).toEqual({ past: [], present: "new", future: [] });
  });
});

describe("useHistory step grouping", () => {
  // Mounts the hook and hands back a live handle to its latest render.
  function mount() {
    const h: { current: ReturnType<typeof useHistory<string>> | null } = { current: null };
    function Probe() {
      h.current = useHistory("a");
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    return { h, unmount: () => act(() => root.unmount()) };
  }

  it("an unkeyed edit right after a field session opens its own step", () => {
    const { h, unmount } = mount();
    act(() => h.current!.set("b", "field-name")); // field commit
    act(() => h.current!.set("c")); // unrelated click, inside the 500 ms window
    act(() => h.current!.undo());
    expect(h.current!.value).toBe("b"); // only the click is undone
    act(() => h.current!.undo());
    expect(h.current!.value).toBe("a");
    unmount();
  });

  it("unkeyed edits inside the window still coalesce", () => {
    const { h, unmount } = mount();
    act(() => h.current!.set("b"));
    act(() => h.current!.set("c"));
    act(() => h.current!.undo());
    expect(h.current!.value).toBe("a");
    unmount();
  });
});
