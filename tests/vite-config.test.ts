// vite-config.test.ts — the dev server must own the port Tauri's devUrl loads.
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";
import tauri from "../src-tauri/tauri.conf.json";

describe("dev server port", () => {
  it("binds exactly the devUrl port and refuses to fall back to another one", () => {
    // Without strictPort, a second Vite already on 5173 bumps ours to 5174 and
    // the Tauri window loads the *other* session's app from 5173 (#107).
    const devPort = Number(new URL(tauri.build.devUrl).port);
    expect(viteConfig.server?.port).toBe(devPort);
    expect(viteConfig.server?.strictPort).toBe(true);
  });

  it("keeps vitest scoped to tests/", () => {
    expect(viteConfig.test?.dir).toBe("tests");
  });
});
