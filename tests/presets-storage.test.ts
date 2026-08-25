// presets-storage.test.ts — the browser storage fallback in src/presets.ts:
// with no Tauri backend and no /api/presets endpoint, the library must
// round-trip through localStorage; with a working endpoint, saves keep their
// throw-on-failure contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
};

beforeEach(() => {
  stored.clear();
  vi.resetModules();
  vi.stubGlobal("localStorage", fakeLocalStorage);
});
afterEach(() => vi.unstubAllGlobals());

const library = {
  styles: ["IPA"],
  barcodes: [{ upc: "012345678905", name: "Flagship" }],
  colors: ["#4169e1"],
};

describe("presets browser fallback", () => {
  it("round-trips through localStorage when the endpoint is missing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("no server"));
    vi.stubGlobal("fetch", fetchMock);
    const { loadPresets, savePresets, normalizePresets } = await import("@/presets");
    await savePresets(normalizePresets(library));
    const loaded = await loadPresets();
    expect(loaded.styles).toEqual(["IPA"]);
    expect(loaded.barcodes).toEqual(library.barcodes);
    expect(loaded.colors).toEqual(["#4169e1"]);
    // The missing endpoint is probed once, then remembered — later loads
    // (every save re-reads first) must not repeat the failing fetch.
    await loadPresets();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an SPA's HTML fallback response as a missing endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<!doctype html>", { status: 200 }),
    ));
    const { loadPresets, EMPTY_PRESETS } = await import("@/presets");
    expect(await loadPresets()).toEqual(EMPTY_PRESETS);
  });

  it("still throws on a failed save when the endpoint answered at load", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(library))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadPresets, savePresets, normalizePresets } = await import("@/presets");
    await loadPresets();
    await expect(savePresets(normalizePresets(library))).rejects.toThrow("500");
    expect(stored.size).toBe(0);
  });
});
