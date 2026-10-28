// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ check: vi.fn(), invoke: vi.fn(async () => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
const agent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows");
const { DesktopUpdater } = await import("../src/components/DesktopUpdater");
agent.mockRestore();

// The NSIS installer closes Label Lab, so the unsaved tabs are walked (the
// shell's beforeRestart, as for a quit) after the download and before it
// runs; Install and Restart is never greyed out (#292).
it("Windows walks the unsaved tabs after downloading and before its exiting installer (#292)", async () => {
  let finish!: () => void;
  const update = {
    version: "0.2.0", currentVersion: "0.1.0", close: vi.fn(async () => {}),
    download: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
    install: vi.fn(async () => {}),
  };
  mocks.check.mockResolvedValue(update);
  const host = document.createElement("div"), bar = document.createElement("div");
  document.body.append(host, bar);
  const root = createRoot(host);
  const beforeRestart = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const render = (request: number) => root.render(createElement(DesktopUpdater, { beforeRestart, checkRequest: request, statusHost: bar }));
  const installButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Install and Restart")!;
  try {
    await act(async () => render(0));
    await act(async () => render(1));
    expect(installButton().disabled).toBe(false);
    await act(async () => installButton().click());
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.download).toHaveBeenCalledWith(expect.any(Function), { timeout: 900_000 });
    expect(beforeRestart).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    // Cancelled walk: no installer, no relaunch; the update waits in the bar.
    expect(beforeRestart).toHaveBeenCalledOnce();
    expect(update.install).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("relaunch_app");
    expect(bar.textContent).toContain("Update available");
    // Install again reuses the finished download rather than fetching (and
    // holding) a second copy of the installer.
    await act(async () => (bar.querySelector("button") as HTMLButtonElement).click());
    await act(async () => installButton().click());
    expect(update.download).toHaveBeenCalledOnce();
    expect(beforeRestart).toHaveBeenCalledTimes(2);
    expect(update.install).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); host.remove(); bar.remove();
  }
});
