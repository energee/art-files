// reveal-dom.test.ts — the "Show in Finder" toast action: named for the
// platform, offered only on the desktop with a saved path, and it asks the
// opener plugin to reveal that exact file.
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => true), revealItemInDir: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: mocks.revealItemInDir }));

import { revealAction, revealLabel } from "../src/reveal";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.revealItemInDir.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it("names the action for each platform", () => {
  vi.stubGlobal("navigator", { userAgent: MAC });
  expect(revealLabel()).toBe("Show in Finder");
  vi.stubGlobal("navigator", { userAgent: WINDOWS });
  expect(revealLabel()).toBe("Show in File Explorer");
  vi.stubGlobal("navigator", { userAgent: LINUX });
  expect(revealLabel()).toBe("Show in Folder");
});

it("offers nothing in the browser or without a path", () => {
  mocks.isTauri.mockReturnValue(false);
  expect(revealAction("/x/Lupula.pdf")).toBeUndefined();
  mocks.isTauri.mockReturnValue(true);
  expect(revealAction(undefined)).toBeUndefined();
  expect(revealAction("")).toBeUndefined();
});

it("reveals the saved file", async () => {
  vi.stubGlobal("navigator", { userAgent: MAC });
  const action = revealAction("/x/Lupula.pdf")!;
  expect(action.label).toBe("Show in Finder");
  await action.onClick();
  expect(mocks.revealItemInDir).toHaveBeenCalledWith("/x/Lupula.pdf");
});
