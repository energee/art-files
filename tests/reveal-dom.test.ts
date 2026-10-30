// reveal-dom.test.ts — the "Show in Finder" toast action: named for the
// platform, offered only on the desktop with a saved path, and it asks the
// opener plugin to reveal that exact file. A reveal that fails (the file was
// moved) becomes an error toast naming the file, never an unhandled rejection
// (which UncaughtErrors would show as "Something went wrong").
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => true), revealItemInDir: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: mocks.revealItemInDir }));

import { notify } from "../src/notify";
import { revealAction, revealLabel } from "../src/reveal";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.revealItemInDir.mockReset();
  mocks.revealItemInDir.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  action.onClick();
  await vi.waitFor(() => expect(mocks.revealItemInDir).toHaveBeenCalledWith("/x/Lupula.pdf"));
});

// Sonner calls an action's onClick without awaiting it, so a rejection that
// escaped would reach `unhandledrejection` and UncaughtErrors would claim the
// last action may not have finished — false for an export that completed.
it.each([["/x/Lupula.pdf"], ["C:\\x\\Lupula.pdf"]])("reports a failed reveal of %s as an error toast naming the file", async (path) => {
  const error = vi.spyOn(notify, "error").mockReturnValue("toast");
  const unhandled = vi.fn();
  window.addEventListener("unhandledrejection", unhandled);
  process.on("unhandledRejection", unhandled);
  try {
    mocks.revealItemInDir.mockRejectedValue(new Error("No such file or directory (os error 2)"));
    revealAction(path)!.onClick();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
      "Couldn't show Lupula.pdf", { description: "No such file or directory (os error 2)" }));
    await new Promise((resolve) => setTimeout(resolve, 0)); // let a leaked rejection surface
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("unhandledrejection", unhandled);
    process.off("unhandledRejection", unhandled);
  }
});

// A path that ends in a separator has no last segment, which would title the
// toast "Couldn't show " with nothing after it: it names the whole path.
it.each([["/x/exports/"], ["C:\\x\\exports\\"]])("names the whole path when %s ends in a separator", async (path) => {
  const error = vi.spyOn(notify, "error").mockReturnValue("toast");
  mocks.revealItemInDir.mockRejectedValue(new Error("No such file or directory (os error 2)"));
  revealAction(path)!.onClick();
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
    `Couldn't show ${path}`, { description: "No such file or directory (os error 2)" }));
});
