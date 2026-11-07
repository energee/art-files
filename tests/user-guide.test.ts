// user-guide.test.ts — Help > User Guide opens the hosted guide, through the
// opener plugin on desktop and a new tab in the browser.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.hoisted(() => vi.fn(async () => {}));
const isTauri = vi.hoisted(() => vi.fn(() => false));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri }));

import { openUserGuide, USER_GUIDE_URL } from "../src/userGuide";

afterEach(() => { vi.restoreAllMocks(); openUrl.mockClear(); isTauri.mockReturnValue(false); });

describe("openUserGuide", () => {
  it("asks the opener plugin on desktop", async () => {
    isTauri.mockReturnValue(true);
    await openUserGuide();
    expect(openUrl).toHaveBeenCalledWith(USER_GUIDE_URL);
  });

  it("opens a new tab in the browser", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    await openUserGuide();
    expect(open).toHaveBeenCalledWith(USER_GUIDE_URL, "_blank", "noopener");
    expect(openUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("is the one URL the desktop app may open", () => {
    const caps = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
    const grant = caps.permissions.find((p: { identifier?: string }) => p.identifier === "opener:allow-open-url");
    expect(grant.allow).toEqual([{ url: USER_GUIDE_URL }]);
  });
});
