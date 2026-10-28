// render-settings-groups-dom.test.tsx — Settings groups its fields under
// Output (what gets built) and Can preview (how the 3D can presents it), in
// that order, and every field keeps its id (UX audit item 15). The theme is
// not here: View → Appearance and the ⌘K palette own it.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { RenderSettings } from "../src/components/RenderSettings";
import { DEFAULT_RENDER } from "../src/settings";

it("groups the fields under Output and Can preview", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(RenderSettings, { value: { ...DEFAULT_RENDER }, onChange: () => undefined }));
    });
    const groups = [...container.querySelectorAll("fieldset")].map((set) => ({
      title: set.querySelector("legend")!.textContent,
      ids: [...set.querySelectorAll("input[id]")].map((input) => input.id),
    }));
    expect(groups).toEqual([
      { title: "Output", ids: ["doc-dpi", "doc-bleed"] },
      { title: "Can preview", ids: ["doc-corner-radius", "doc-edge-softness"] },
    ]);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
