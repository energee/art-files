// confirm-overwrite.test.ts — the check before a Save rewrites a bound file in
// place (#682). A file another tab or app changed since this tab last saw it
// stops for a native alert; an unchanged file, a missing one, or one this tab
// has no baseline for saves as before. Anything but Overwrite must not write.
import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  mtime: 100 as number | null,
  statFails: false,
  answer: "Cancel",
  message: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => native.mtime !== null,
  stat: async () => {
    if (native.statFails) throw new Error("no access");
    return { mtime: new Date(native.mtime!) };
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: native.message }));
import { confirmOverwrite } from "../src/files";

beforeEach(() => {
  native.mtime = 100;
  native.statFails = false;
  native.message.mockReset();
  native.message.mockImplementation(async () => native.answer);
});

it("saves without asking when the file is as this tab last saw it", async () => {
  expect(await confirmOverwrite("/a/Beer.label", 100)).toBe("overwrite");
  expect(native.message).not.toHaveBeenCalled();
});

it("saves without asking when there is nothing to compare or nothing to lose", async () => {
  expect(await confirmOverwrite("/a/Beer.label", undefined)).toBe("overwrite");
  native.mtime = null; // deleted: rewriting it loses nothing
  expect(await confirmOverwrite("/a/Beer.label", 100)).toBe("overwrite");
  native.mtime = 100;
  native.statFails = true; // can't tell: the write reports any real problem
  expect(await confirmOverwrite("/a/Beer.label", 50)).toBe("overwrite");
  expect(native.message).not.toHaveBeenCalled();
});

it.each([
  ["Overwrite", "overwrite"],
  ["Save As…", "save-as"],
  ["Cancel", "cancel"],
  ["anything else", "cancel"],
])("a changed file asks, and %s means %s", async (answer, choice) => {
  native.answer = answer;
  expect(await confirmOverwrite("/a/Beer.label", 50)).toBe(choice);
  expect(native.message).toHaveBeenCalledOnce();
});

// NSAlert's first button answers Return, so it must not be the destructive one.
it("names the file, and Return means Save As, not Overwrite", async () => {
  await confirmOverwrite("/a/Beer.label", 50);
  const [text, options] = native.message.mock.calls[0];
  expect(`${options.title} ${text}`).toContain("Beer.label");
  expect(options.buttons).toEqual({ yes: "Save As…", no: "Overwrite", cancel: "Cancel" });
});
