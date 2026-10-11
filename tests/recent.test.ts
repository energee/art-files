// recent.test.ts — the File → Open Recent list: most recent first, deduped by
// path, capped at ten, and tolerant of a missing or mangled store.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecent, forgetRecent, recentLabels, recentTitles, rememberRecent } from "../src/recent";

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
});

describe("recent labels", () => {
  it("lists the most recent first and moves a re-opened path to the top", () => {
    rememberRecent("/a/One.label");
    rememberRecent("/a/Two.label");
    rememberRecent("/a/One.label");
    expect(recentLabels()).toEqual(["/a/One.label", "/a/Two.label"]);
  });

  it("keeps at most ten", () => {
    for (let i = 0; i < 12; i++) rememberRecent(`/a/${i}.label`);
    const list = recentLabels();
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("/a/11.label");
    expect(list).not.toContain("/a/1.label");
  });

  it("forgets one path, and clears them all", () => {
    rememberRecent("/a/One.label");
    rememberRecent("/a/Two.label");
    forgetRecent("/a/One.label");
    expect(recentLabels()).toEqual(["/a/Two.label"]);
    clearRecent();
    expect(recentLabels()).toEqual([]);
  });

  it("reads a mangled or missing store as empty", () => {
    stored.set("labellab.recent", "{nope");
    expect(recentLabels()).toEqual([]);
    stored.set("labellab.recent", JSON.stringify(["/a/ok.label", 3, null]));
    expect(recentLabels()).toEqual(["/a/ok.label"]);
    vi.stubGlobal("localStorage", undefined);
    expect(recentLabels()).toEqual([]);
    expect(() => rememberRecent("/a/x.label")).not.toThrow();
  });

  it("titles each row by file name, adding the folder when two names match", () => {
    expect(recentTitles(["/a/One.label", "C:\\b\\Two.label", "/c/One.label"]))
      .toEqual(["One.label — a", "Two.label", "One.label — c"]);
  });
});
