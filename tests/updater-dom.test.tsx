// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { AUTO_CHECK_DELAY_MS, DesktopUpdater, RECHECK_MIN_INTERVAL_MS } from "../src/components/DesktopUpdater";

const mocks = vi.hoisted(() => ({ check: vi.fn(), invoke: vi.fn(), desktop: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: mocks.desktop }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));

beforeEach(() => vi.clearAllMocks());

it("quietly advertises updates, keeps Later discoverable, and reuses the update across status-bar hosts", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  const update = { version: "0.2.0", currentVersion: "0.1.0", body: "- Improved labels", close: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn() };
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
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("0.1.0 → 0.2.0");
    // Installing no longer restarts, so the unsaved-changes warning waits for the restart step.
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("unsaved changes");
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

it("shows Up to date after the launch check and keeps it after closing a manual check", async () => {
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
    expect(bar.querySelector('[role="status"]')?.textContent?.trim()).toBe("Up to date");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={1} statusHost={bar} />));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Label Lab is up to date");
    const close = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Close")!;
    await act(async () => close.click());
    expect(bar.textContent?.trim()).toBe("Up to date");
  } finally {
    await act(async () => root.unmount());
    container.remove(); bar.remove();
    vi.useRealTimers();
  }
});

it("moves download progress into the status bar once Install is chosen", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  let report: ((e: { event: string; data: Record<string, number> }) => void) | undefined;
  const update = {
    version: "0.2.0", currentVersion: "0.1.0", body: "- Improved labels", close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn((cb: typeof report) => { report = cb; return new Promise<void>(() => {}); }),
  };
  mocks.check.mockResolvedValue(update);
  const container = document.createElement("div");
  const bar = document.createElement("div");
  document.body.append(container, bar);
  const root = createRoot(container);
  const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  try {
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS); });
    await act(async () => button("Update available").click());
    await act(async () => button("Install").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(bar.textContent).toContain("Installing 0.2.0");
    await act(async () => { report!({ event: "Started", data: { contentLength: 200 } }); });
    await act(async () => { report!({ event: "Progress", data: { chunkLength: 100 } }); });
    expect(bar.textContent).toContain("50%");
    await act(async () => { report!({ event: "Finished", data: {} }); });
    expect(bar.textContent).toContain("Finishing…");
  } finally {
    await act(async () => root.unmount());
    container.remove(); bar.remove();
    vi.useRealTimers();
  }
});

it("installs without relaunching, then offers Restart to finish from the status bar", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  const onInstalled = vi.fn();
  const update = {
    version: "0.2.0", currentVersion: "0.1.0", body: "- Improved labels", close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
  mocks.check.mockResolvedValue(update);
  const container = document.createElement("div");
  const bar = document.createElement("div");
  document.body.append(container, bar);
  const root = createRoot(container);
  const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  try {
    await act(async () => root.render(
      <DesktopUpdater dirty checkRequest={0} statusHost={bar} onInstalled={onInstalled} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await act(async () => button("Update available").click());
    await act(async () => button("Install").click());
    // The download timeout caps the whole transfer, so slow links get 15 minutes.
    expect(update.downloadAndInstall).toHaveBeenCalledWith(expect.any(Function), { timeout: 900_000 });
    expect(mocks.invoke).not.toHaveBeenCalledWith("relaunch_app");
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(bar.textContent).toContain("Restart to finish · 0.2.0");
    await act(async () => button("Restart to finish").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("unsaved changes");
    expect(button("Restart Now").disabled).toBe(true);
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} onInstalled={onInstalled} />));
    await act(async () => button("Restart Now").click());
    expect(mocks.invoke).toHaveBeenCalledWith("relaunch_app");
  } finally {
    await act(async () => root.unmount());
    container.remove(); bar.remove();
    vi.useRealTimers();
  }
});

it("a manual check during a download shows the download, and Restart Now reports a failed relaunch", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  let finish!: () => void;
  const update = {
    version: "0.2.0", currentVersion: "0.1.0", body: "- Improved labels", close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
  };
  mocks.check.mockResolvedValue(update);
  const container = document.createElement("div");
  const bar = document.createElement("div");
  document.body.append(container, bar);
  const root = createRoot(container);
  const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  const dialog = () => document.querySelector('[role="dialog"]')?.textContent ?? "";
  try {
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS); });
    await act(async () => button("Update available").click());
    await act(async () => button("Install").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Check for Updates… while downloading: a titled dialog, not a blank one.
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={1} statusHost={bar} />));
    expect(dialog()).toContain("Installing Label Lab 0.2.0");
    await act(async () => button("Close").click());
    expect(bar.textContent).toContain("Installing 0.2.0");
    await act(async () => { finish(); });
    expect(bar.textContent).toContain("Restart to finish · 0.2.0");
    // A rejected relaunch surfaces as an error instead of an unhandled rejection.
    mocks.invoke.mockRejectedValueOnce(new Error("no permission"));
    await act(async () => button("Restart to finish").click());
    await act(async () => button("Restart Now").click());
    expect(dialog()).toContain("Could not restart: no permission");
    // Closing that error keeps the installed update: the status bar still
    // offers the restart, and the menu's Restart to Update reopens a titled
    // dialog rather than a blank one (issue #123).
    await act(async () => button("Close").click());
    expect(bar.textContent).toContain("Restart to finish · 0.2.0");
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={2} statusHost={bar} />));
    expect(dialog()).toContain("Restart to finish updating");
    expect(update.close).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove(); bar.remove();
    vi.useRealTimers();
  }
});

it("re-checks quietly when the window regains focus, at most once per throttle window", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  mocks.check.mockResolvedValue(null);
  const container = document.createElement("div");
  const bar = document.createElement("div");
  document.body.append(container, bar);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS); });
    expect(mocks.check).toHaveBeenCalledTimes(1);
    // Focus right after launch is throttled.
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.check).toHaveBeenCalledTimes(1);
    // Focus after the throttle window runs one quiet check with no dialog.
    await act(async () => { await vi.advanceTimersByTimeAsync(RECHECK_MIN_INTERVAL_MS); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // A second focus inside the window stays quiet.
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.check).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove(); bar.remove();
    vi.useRealTimers();
  }
});

it("blocks restarting over dirty tabs and permits it after saving (#292)", async () => {
  mocks.invoke.mockResolvedValue(true);
  mocks.check.mockResolvedValue({ version: "0.2.0", currentVersion: "0.1.0", close: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn().mockResolvedValue(undefined) });
  const host = document.createElement("div"); const bar = document.createElement("div"); document.body.append(host, bar);
  const root = createRoot(host);
  const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(<DesktopUpdater dirty checkRequest={0} statusHost={bar} />));
    await act(async () => root.render(<DesktopUpdater dirty checkRequest={1} statusHost={bar} />));
    await act(async () => button("Install").click());
    await act(async () => (bar.querySelector("button") as HTMLButtonElement).click());
    expect(button("Restart Now").disabled).toBe(true);
    await act(async () => button("Restart Now").click());
    expect(mocks.invoke).not.toHaveBeenCalledWith("relaunch_app");
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={1} statusHost={bar} />));
    await act(async () => button("Restart Now").click());
    expect(mocks.invoke).toHaveBeenCalledWith("relaunch_app");
  } finally { await act(async () => root.unmount()); host.remove(); bar.remove(); }
});
it("keeps failed installs discoverable and offers a fresh check (#318)", async () => {
  mocks.invoke.mockResolvedValue(true);
  mocks.check.mockResolvedValue({ version: "0.2.0", currentVersion: "0.1.0", close: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn().mockRejectedValue(new Error("offline")) });
  const host = document.createElement("div"); const bar = document.createElement("div"); document.body.append(host, bar);
  const root = createRoot(host);
  const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} />));
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={1} statusHost={bar} />));
    await act(async () => button("Install").click());
    // Install closed the dialog for status-bar progress; the rejection reopens it.
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Could not install the update: offline");
    await act(async () => button("Close").click());
    expect(bar.textContent).toContain("Update failed");
    await act(async () => (bar.querySelector("button") as HTMLButtonElement).click());
    await act(async () => button("Try again").click());
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Update available");
  } finally { await act(async () => root.unmount()); host.remove(); bar.remove(); }
});

it("logs a failed automatic check without opening the dialog or marking the status bar", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(true);
  mocks.check.mockRejectedValue(new Error("offline"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div"); const bar = document.createElement("div"); document.body.append(host, bar);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_CHECK_DELAY_MS); });
    expect(mocks.check).toHaveBeenCalledTimes(1);
    // Exactly one call: the silenced spy must not hide any other console error.
    expect(log).toHaveBeenCalledExactlyOnceWith("Automatic update check failed: offline");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(bar.textContent).toBe("");
  } finally {
    await act(async () => root.unmount()); host.remove(); bar.remove();
    log.mockRestore();
    vi.useRealTimers();
  }
});

it("a failed manual check leaves no failure in the status bar once closed", async () => {
  mocks.invoke.mockResolvedValue(true);
  mocks.check.mockRejectedValue(new Error("offline"));
  const host = document.createElement("div"); const bar = document.createElement("div"); document.body.append(host, bar);
  const root = createRoot(host);
  const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={0} statusHost={bar} />));
    await act(async () => root.render(<DesktopUpdater dirty={false} checkRequest={1} statusHost={bar} />));
    expect(document.body.textContent).toContain("offline");
    await act(async () => button("Close").click());
    // Nothing failed to install, so there is nothing to retry from the bar.
    expect(bar.textContent).not.toContain("Update failed");
  } finally { await act(async () => root.unmount()); host.remove(); bar.remove(); }
});
