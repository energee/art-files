// semantic-colour.test.ts — keeps docs/plans/semantic-color.md's one rule
// enforced: a raw accent token (`--primary` etc.) never carries text. It
// only reaches 3.3-3.9:1 on white in light mode (index.css's file header),
// so text must use the `-text` variant instead. Guards src/components/**
// (app code); src/components/ui/** is the vendored shadcn layer, already
// fixed once by hand and reviewed for its own `data-[variant=destructive]`
// escape hatches, so it's exempt here rather than false-positiving on those.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACCENTS = ["primary", "destructive", "attention", "warning", "success", "info"];
// text-primary, text-destructive/50, hover:text-primary, etc. — never
// text-primary-text or text-primary-foreground (those are legal).
const RAW_TEXT = new RegExp(`\\btext-(${ACCENTS.join("|")})(?:/\\d+)?\\b(?!-)`, "g");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "ui") continue; // vendored shadcn layer, exempt
      out.push(...tsxFiles(path));
    } else if (name.endsWith(".tsx") || name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("semantic colour — no raw accent on text", () => {
  it("src/components/**, excluding ui/, never uses text-<accent> raw", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(process.cwd(), "src/components"))) {
      const text = readFileSync(file, "utf8");
      const hits = text.match(RAW_TEXT);
      if (hits) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  // The walk above skips ui/, but that is where the violations came FROM: the
  // stock shadcn variants put a raw accent on text, and re-running the CLI to
  // pick up an upstream change would silently overwrite the fix. So assert the
  // corrected spelling positively — this fails on a re-vendor, which is the
  // only way the vendored layer regresses.
  it.each([
    ["ui/button.tsx", ["bg-destructive-soft", "text-destructive-text", "bg-attention-soft", "text-attention-text"]],
    ["ui/alert.tsx", ["text-destructive-text"]],
    ["ui/dropdown-menu.tsx", ["data-[variant=destructive]:text-destructive-text", "data-[variant=attention]:text-attention-text"]],
    ["ui/menubar.tsx", ["data-[variant=destructive]:text-destructive-text"]],
    ["ui/select.tsx", ["text-success-text"]],
  ])("%s keeps its hand-applied semantic tokens", (file, expected) => {
    const text = readFileSync(join(process.cwd(), "src/components", file), "utf8");
    for (const token of expected) expect(text, `${file} lost ${token}`).toContain(token);
  });
});
