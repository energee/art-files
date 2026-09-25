// docs-menus.test.ts — every "File/Edit/View → X" the user guide names is a real menu item.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { APP_MENUS } from "@/components/AppMenu";

const DOCS = join(__dirname, "../docs-site/content/docs");

it("names only items that exist in the menu it points at", () => {
  // Item and nested-submenu names per top-level menu, without the "…" suffix.
  const names = new Map(APP_MENUS.map((menu) => [menu.text, menu.items.flatMap((entry) =>
    "text" in entry ? [entry.text.replace(/…$/, "")] : [])]));
  const bad: string[] = [];
  for (const file of readdirSync(DOCS, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".mdx")) continue;
    const text = readFileSync(join(DOCS, file), "utf8");
    for (const [, menu, rest] of text.matchAll(/\b(File|Edit|View) → (?:\*\*)?([^\n]+)/g)) {
      // A mention may run on ("Save Master is the gate", "Label / Mask"),
      // so it only has to START with a real item's name.
      if (!names.get(menu)!.some((name) => rest.startsWith(name))) {
        bad.push(`${file}: ${menu} → ${rest.slice(0, 40)}`);
      }
    }
  }
  // The docs said Edit → New Variant; it lives in the palette and picker (#136).
  expect(bad).toEqual([]);
});
