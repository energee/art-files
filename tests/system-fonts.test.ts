// system-fonts.test.ts — the desktop System Fonts source (font import task
// 14): the Rust list groups into families, and importing a family reads its
// faces nearest regular, semibold and bold through read_system_font and
// imports them as one font. Tauri's invoke is mocked.
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const { listSystemFonts, importSystemFamily } = await import("../src/systemFonts");
const { readImportedFont } = await import("../src/fontImport");

const REGULAR = new Uint8Array(readFileSync("tests/fixtures/fonts/SVN-Poppins-Regular.ttf"));
const BOLD = new Uint8Array(readFileSync("tests/fixtures/fonts/SVN-Poppins-Bold.ttf"));

const face = (family: string, postscript: string, weight: number) =>
  ({ family, postscript, weight, path: `/Library/Fonts/${postscript}.ttf` });
const SVN = [
  face("SVN-Poppins", "SVN-Poppins-Light", 300),
  face("SVN-Poppins", "SVN-Poppins-Regular", 400),
  face("SVN-Poppins", "SVN-Poppins-Bold", 700),
  face("SVN-Poppins", "SVN-Poppins-Black", 900),
];

beforeEach(() => { invoke.mockReset(); });

it("groups the listed faces by family, in list order", async () => {
  invoke.mockResolvedValueOnce([face("Arial", "ArialMT", 400), face("Arial", "Arial-BoldMT", 700), ...SVN]);
  const families = await listSystemFonts();
  expect(invoke).toHaveBeenCalledWith("list_system_fonts");
  expect(families.map((f) => [f.family, f.faces.map((x) => x.postscript)])).toEqual([
    ["Arial", ["ArialMT", "Arial-BoldMT"]],
    ["SVN-Poppins", ["SVN-Poppins-Light", "SVN-Poppins-Regular", "SVN-Poppins-Bold", "SVN-Poppins-Black"]],
  ]);
  expect(await listSystemFonts()).toBe(families); // memoized: one scan a session
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("imports Regular and Bold of a Light/Regular/Bold/Black family under one id", async () => {
  invoke.mockImplementation(async (cmd: string, args: { path: string }) => {
    expect(cmd).toBe("read_system_font");
    if (args.path.endsWith("SVN-Poppins-Regular.ttf")) return REGULAR.slice().buffer;
    if (args.path.endsWith("SVN-Poppins-Bold.ttf")) return BOLD.slice().buffer;
    throw new Error(`unexpected read ${args.path}`);
  });
  const { id, font } = await importSystemFamily({ family: "SVN-Poppins", faces: SVN });
  expect(invoke.mock.calls.map(([, args]) => args.path).sort()).toEqual(
    ["/Library/Fonts/SVN-Poppins-Bold.ttf", "/Library/Fonts/SVN-Poppins-Regular.ttf"]);
  expect(font.faces.regular.name).toBe("SVN-Poppins-Regular.ttf");
  expect(font.faces.semibold.name).toBe("SVN-Poppins-Bold.ttf");
  expect(font.faces.bold.name).toBe("SVN-Poppins-Bold.ttf");
  // The same id as importing the two files by hand.
  const byHand = await readImportedFont([
    { name: "SVN-Poppins-Regular.ttf", bytes: REGULAR }, { name: "SVN-Poppins-Bold.ttf", bytes: BOLD }]);
  expect(id).toBe(byHand.id);
});

it("a refused read surfaces as an error", async () => {
  invoke.mockRejectedValue("not a listed system font");
  await expect(importSystemFamily({ family: "SVN-Poppins", faces: SVN })).rejects.toBe("not a listed system font");
});
