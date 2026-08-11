// history.test.ts — the undo/redo stack transitions behind useHistory.
import { describe, expect, it } from "vitest";
import { pushed, redone, resetTo, undone, type Stacks } from "../src/history";

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
    const edited = undone(pushed(pushed(resetTo("old"), "draft", false), "final", false));
    expect(resetTo("new")).toEqual({ past: [], present: "new", future: [] });
    expect(resetTo(edited.present)).toEqual({ past: [], present: "draft", future: [] });
  });
});
