// view-state-dom.test.tsx — the preview view has one source of truth. The
// status bar's Label | Mask | Rendered | Can control and the View menu's checks both
// read viewState(), so mid-split ("Compare") neither claims Label; the
// one-can / four-pack choice is a View command as well as the status-bar 1|4
// toggle; the zoom readout's "%" sits inside its bordered control; and the
// status bar has no DPI readout (it lives in Settings → PSD resolution).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";

type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
const probe = vi.hoisted(() => ({
  actions: [] as Command[], checked: {} as Partial<Record<string, boolean>>,
  preview: null as PreviewProps | null, canMode: null as string | null, curvePct: null as number | null,
}));
vi.mock("../src/components/PreviewCompare", () => ({
  SNAP_PT: 6, PreviewCompare: (props: PreviewProps) => { probe.preview = props; return null; },
}));
vi.mock("../src/components/CanView", () => ({
  CanView: (props: { mode: string; curvePct: number }) => {
    probe.canMode = props.mode; probe.curvePct = props.curvePct; return null;
  },
}));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (props: { actions: Command[]; checked: Partial<Record<string, boolean>> }) => {
    probe.actions = props.actions; probe.checked = props.checked; return null;
  },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor, viewState } from "../src/App";

async function mountEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  const unmount = async () => { await act(async () => { root.unmount(); }); container.remove(); };
  return { container, unmount };
}

const press = (key: string) => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
});
const run = (id: string) => act(async () => { probe.actions.find((c) => c.id === id)!.run(); });
const command = (id: string) => probe.actions.find((c) => c.id === id)!;
const viewGroup = (c: HTMLElement) => c.querySelector('[role="group"][aria-label="View mode"]')!;
const pressed = (c: HTMLElement) => [...viewGroup(c).querySelectorAll("button")]
  .filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);

it("viewState names the four states, with Compare its own", () => {
  expect(viewState("2d", 0)).toBe("label");
  expect(viewState("2d", 40)).toBe("compare");
  expect(viewState("2d", 100)).toBe("mask");
  expect(viewState("can", 40)).toBe("can");
  expect(viewState("rendered", 40)).toBe("rendered");
});

it("the status bar and View menu agree on the view, including mid-split", async () => {
  const { container, unmount } = await mountEditor();
  try {
    const group = viewGroup(container);
    expect(group.getAttribute("aria-keyshortcuts")).toBe("1 2 3 4");
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Label", "Mask", "Rendered", "Can"]);
    expect(pressed(container)).toEqual(["Label"]);
    expect(probe.checked).toMatchObject({ "view-label": true, "view-mask": false, "view-can": false });

    await act(async () => probe.preview!.onSplit!(40));
    expect(pressed(container)).toEqual([]);
    expect(container.textContent).toContain("Compare");
    // The group names the state for assistive tech, not just on screen.
    expect(document.getElementById(group.getAttribute("aria-describedby")!)?.textContent).toBe("Compare");
    expect(probe.checked).toMatchObject({ "view-label": false, "view-mask": false, "view-can": false });

    await act(async () => probe.preview!.onSplit!(100));
    expect(pressed(container)).toEqual(["Mask"]);
    expect(container.textContent).not.toContain("Compare");
    expect(group.hasAttribute("aria-describedby")).toBe(false);
    expect(probe.checked).toMatchObject({ "view-mask": true });

    // A segment picks its view directly; Can comes up from any state.
    const can = [...group.querySelectorAll("button")].find((b) => b.textContent === "Can")!;
    await act(async () => { can.click(); });
    expect(pressed(container)).toEqual(["Can"]);
    expect(probe.checked).toMatchObject({ "view-can": true, "view-mask": false });

    // Rendered is the flat label in the 3D scene: metallic foil and matte ink.
    const rendered = [...group.querySelectorAll("button")].find((b) => b.textContent === "Rendered")!;
    await act(async () => { rendered.click(); });
    expect(pressed(container)).toEqual(["Rendered"]);
    expect(probe.checked).toMatchObject({ "view-rendered": true, "view-can": false });
    await vi.waitFor(() => expect(probe.canMode).toBe("flat"));
    // The 1|4 count belongs to the Can view only.
    expect(container.querySelector('[aria-label="Cans shown"]')).toBeNull();
    expect(command("view-four-pack").disabled).toBe(true);
    // Rendered has its own Curve knob, a subtle bend by default.
    const curve = container.querySelector<HTMLInputElement>('input[type="range"][aria-label="Curve"]')!;
    expect(curve.value).toBe("15");
    expect(probe.curvePct).toBe(15);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(curve, "40");
      curve.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(probe.curvePct).toBe(40);
    await act(async () => { can.click(); });
    expect(container.querySelector('[aria-label="Curve"]')).toBeNull();
  } finally { await unmount(); }
});

it("One Can / Four-Pack are View commands, live only in the Can view", async () => {
  const { unmount } = await mountEditor();
  try {
    expect(command("view-one-can").disabled).toBe(true);
    expect(command("view-four-pack").disabled).toBe(true);
    await press("4");
    await vi.waitFor(() => expect(probe.canMode).toBe("can"));
    expect(command("view-four-pack").disabled).toBe(false);
    expect(probe.checked).toMatchObject({ "view-one-can": true, "view-four-pack": false });
    await run("view-four-pack");
    expect(probe.canMode).toBe("pack");
    expect(probe.checked).toMatchObject({ "view-one-can": false, "view-four-pack": true });
    await run("view-one-can");
    expect(probe.canMode).toBe("can");
  } finally { await unmount(); }
});

it("the zoom readout's % sits inside its bordered control", async () => {
  const { container, unmount } = await mountEditor();
  try {
    const zoom = container.querySelector('[aria-label="Zoom percentage"]')!;
    const control = zoom.closest("label")!;
    expect(control).not.toBeNull();
    expect(control.className).toContain("border");
    expect(control.textContent).toBe("%");
  } finally { await unmount(); }
});

// The DPI setting only shapes PSD export and the pixel ruler, so it lives in
// Settings → PSD resolution, not in the status bar.
it("the status bar carries no DPI readout", async () => {
  const { container, unmount } = await mountEditor();
  try {
    expect([...container.querySelectorAll("button")].some((b) => /DPI/.test(b.textContent ?? ""))).toBe(false);
  } finally { await unmount(); }
});
