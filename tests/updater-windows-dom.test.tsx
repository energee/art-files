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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("Windows rechecks dirty tabs after downloading and before its exiting installer (#292)", async () => {
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
  const render = (dirty: boolean, request: number) => root.render(createElement(DesktopUpdater, { dirty, checkRequest: request, statusHost: bar }));
  const installButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Install and Restart")!;
  try {
    await act(async () => render(true, 0));
    await act(async () => render(true, 1));
    expect(installButton().disabled).toBe(true);
    await act(async () => render(false, 1));
    await act(async () => installButton().click());
    expect(update.download).toHaveBeenCalledOnce();
    await act(async () => render(true, 1));
    await act(async () => { finish(); });
    expect(update.install).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("relaunch_app");
    expect(installButton().disabled).toBe(true);
    // Once the tabs are saved, Install reuses the finished download rather
    // than fetching (and holding) a second copy of the installer.
    await act(async () => render(false, 1));
    await act(async () => installButton().click());
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.install).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); host.remove(); bar.remove();
  }
});
