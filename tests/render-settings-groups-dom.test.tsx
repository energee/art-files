// render-settings-groups-dom.test.tsx — Settings groups its fields under
// Output (what gets built) and Can preview (how the 3D can presents it), in
// that order, and every field keeps its id (UX audit item 15). The theme is
// not here: View → Appearance and the ⌘K palette own it.
// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { RenderSettings } from "../src/components/RenderSettings";
import { DEFAULT_RENDER, loadRenderSettings, saveRenderSettings } from "../src/settings";

it("lets the operator enable and disable two-file exports", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let current = { ...DEFAULT_RENDER };
  function Settings() {
    const [value, onChange] = useState(DEFAULT_RENDER);
    current = value;
    return createElement(RenderSettings, { value, onChange });
  }
  try {
    await act(async () => { root.render(createElement(Settings)); });
    // "Export as" names both outcomes: One file | Art + mask.
    const group = container.querySelector('[aria-labelledby="export-as"]')!;
    const [one, pair] = [...group.querySelectorAll<HTMLButtonElement>("button")];
    expect([one.textContent, pair.textContent]).toEqual(["One file", "Art + mask"]);
    expect(one.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { pair.click(); });
    expect(pair.getAttribute("aria-pressed")).toBe("true");
    expect(current.twoFilePdfExport).toBe(true);
    await act(async () => { one.click(); });
    expect(current.twoFilePdfExport).toBe(false);
    // Pressing the chosen side again keeps it: one of the two is always on.
    await act(async () => { one.click(); });
    expect(current.twoFilePdfExport).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("defaults the two-file setting off and persists it independently of numeric knobs", () => {
  localStorage.removeItem("labellab.render");
  expect(loadRenderSettings().twoFilePdfExport).toBe(false);
  saveRenderSettings({ ...DEFAULT_RENDER, twoFilePdfExport: true });
  expect(loadRenderSettings().twoFilePdfExport).toBe(true);
  localStorage.removeItem("labellab.render");
});
