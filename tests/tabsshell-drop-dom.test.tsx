// tabsshell-drop-dom.test.tsx — the shell's window file-drop guard: any OS
// file drag outside a file well is prevented so the webview never navigates
// to the file (#121), a dropped .label opens through the shell's open routing
// (the same path as File → Open's hidden input), and anything else is
// ignored. DocumentEditor is stubbed (so no AssetDropOverlay is mounted —
// the guard must hold on its own) and records the fileToOpen it is handed.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_DROP_ATTR } from "../src/components/FileDrop";
import { fieldWell, fileDrag, label, pdf } from "./dom-drag";

const opened: unknown[] = [];
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", () => ({
  DocumentEditor: (p: { fileToOpen: unknown }) => {
    if (p.fileToOpen) opened.push(p.fileToOpen);
    return null;
  },
}));

const { default: TabsShell } = await import("../src/TabsShell");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  opened.length = 0;
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(createElement(TabsShell)); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe("TabsShell window drops", () => {
  it("prevents navigation for every file drag outside a well", () => {
    for (const f of [pdf, label]) {
      expect(fileDrag("dragover", f).defaultPrevented).toBe(true);
      expect(fileDrag("drop", f).defaultPrevented).toBe(true);
    }
  });

  it("opens a dropped .label through the shell's open routing", () => {
    fileDrag("drop", label);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ file: label });
  });

  it("ignores an unclaimed file (no open)", () => {
    fileDrag("drop", pdf);
    expect(opened).toHaveLength(0);
  });

  it("leaves a drag or drop on a file well to that well", () => {
    const field = fieldWell(FILE_DROP_ATTR);
    expect(fileDrag("dragover", label, field).defaultPrevented).toBe(false);
    expect(fileDrag("drop", label, field).defaultPrevented).toBe(false);
    expect(opened).toHaveLength(0);
    field.remove();
  });
});
