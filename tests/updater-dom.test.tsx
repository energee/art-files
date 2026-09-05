// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DesktopUpdater } from "../src/components/DesktopUpdater";

const mocks = vi.hoisted(() => ({ check: vi.fn(), invoke: vi.fn(), desktop: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: mocks.desktop }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("quietly advertises updates, keeps Later discoverable, and reuses the update across status-bar hosts", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  const update = { version: "0.2.0", body: "- Improved labels", close: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn() };
  mocks.check.mockResolvedValue(update);
  const container = document.createElement("div");
  const bar = document.createElement("div");
  const nextBar = document.createElement("div");
  document.body.append(container, bar, nextBar);
  const root = createRoot(container);
  const render = (host: HTMLElement, request = 0) => root.render(
    <DesktopUpdater dirty checkRequest={request} statusHost={host} />,
  );
  const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  try {
    await act(async () => render(bar));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(bar.textContent).toContain("Update available · 0.2.0");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button("Update available").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("unsaved changes");
    await act(async () => button("Later").click());
    expect(update.close).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    await act(async () => render(nextBar));
    expect(bar.textContent).toBe("");
    expect(nextBar.textContent).toContain("Update available");
    await act(async () => render(nextBar, 1));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Improved labels");
    expect(mocks.check).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove(); bar.remove(); nextBar.remove();
    vi.useRealTimers();
  }
  expect(update.close).toHaveBeenCalledTimes(1);
});

it("shows Up-to-date after the launch check and keeps it after closing a manual check", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  mocks.check.mockResolvedValue(null);
  const container = document.createElement("div");
  const bar = document.createElement("div");
  document.body.append(container, bar);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} />));
    expect(bar.textContent).toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(bar.querySelector('[role="status"]')?.textContent?.trim()).toBe("Up-to-date");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={1} statusHost={bar} />));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Label Lab is up to date");
    const close = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Close")!;
    await act(async () => close.click());
    expect(bar.textContent?.trim()).toBe("Up-to-date");
  } finally {
    await act(async () => root.unmount());
    container.remove(); bar.remove();
    vi.useRealTimers();
  }
});
