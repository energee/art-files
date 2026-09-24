// tabsshell-drop-dom.test.tsx — a .label dropped anywhere on the window opens
// through the shell's open routing (the same path as File → Open's hidden
// input), while unclaimed files (a PDF) and drops on a file well are left
// alone. DocumentEditor is stubbed to record the fileToOpen it is handed.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_DROP_ATTR } from "../src/components/FileDrop";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** A Finder-shaped drop (types includes "Files"); happy-dom's DataTransfer
 *  can't carry OS files. */
function drop(file: File, target: EventTarget = document.body) {
  const e = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", {
    value: { types: ["Files"], items: [{ kind: "file", type: file.type }], files: [file] },
  });
  act(() => { target.dispatchEvent(e); });
  return e;
}

const label = new File(["PK"], "beer.label", { type: "" });
const pdf = new File(["%PDF"], "art.pdf", { type: "application/pdf" });

describe("TabsShell window drops", () => {
  it("opens a dropped .label through the shell's open routing", () => {
    expect(drop(label).defaultPrevented).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ file: label });
  });

  it("ignores an unclaimed file (no open)", () => {
    drop(pdf);
    expect(opened).toHaveLength(0);
  });

  it("leaves a .label dropped on a file well to that well", () => {
    const field = document.createElement("div");
    field.setAttribute(FILE_DROP_ATTR, "");
    document.body.appendChild(field);
    drop(label, field);
    expect(opened).toHaveLength(0);
    field.remove();
  });
});
