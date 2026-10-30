// theme-contrast.test.ts — WCAG AA contrast coverage for src/index.css's
// `:root` theme tokens. Parses the plain `:root { ... }` block (not the
// `data-theme` overrides), resolves `light-dark()`, `var()` and the
// `color-mix(in oklab, ...)` formula the accent `-text` tokens use, and
// checks the pairs the colour scheme in docs/plans/template-switch.md
// commits to. Raw accents (`--primary` etc.) are fills/rings/dots, so they
// only need the 3:1 non-text minimum; the `-text` tokens are the ones put on
// tinted/plain backgrounds as text, so those need 4.5:1.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

// ---- :root block extraction --------------------------------------------

function rootBlock(source: string): string {
  const match = source.match(/(?<!\[data-theme="[a-z]*"\]\s*)\n:root\s*\{([^}]*)\}/);
  if (!match) throw new Error("could not find :root { ... } block in index.css");
  return match[1];
}

function parseDeclarations(block: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const line of block.split(";")) {
    const m = line.match(/(--[\w-]+)\s*:\s*(.+)/s);
    if (!m) continue;
    decls.set(m[1].trim(), m[2].trim());
  }
  return decls;
}

const decls = parseDeclarations(rootBlock(css));

// ---- top-level-comma splitting (respects nested parens) -----------------

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim());
}

// ---- colour math ----------------------------------------------------------

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours. */
function contrast(hexA: string, hexB: string): number {
  const la = luminance(hexToRgb(hexA));
  const lb = luminance(hexToRgb(hexB));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToOklab([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const [l_, m_, s_] = [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)];
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToRgb([L, a, b]: [number, number, number]): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return [linearToSrgb(lr) * 255, linearToSrgb(lg) * 255, linearToSrgb(lb) * 255];
}

/** `color-mix(in oklab, hexA pctA%, hexB)`, matching the CSS formula. */
function mixOklab(hexA: string, pctA: number, hexB: string): string {
  const t = pctA / 100;
  const okA = rgbToOklab(hexToRgb(hexA));
  const okB = rgbToOklab(hexToRgb(hexB));
  const mixed: [number, number, number] = [0, 1, 2].map(
    (i) => okA[i] * t + okB[i] * (1 - t),
  ) as [number, number, number];
  return toHex(oklabToRgb(mixed));
}

// ---- token resolution (light-dark / var / color-mix) ---------------------

type Scheme = "light" | "dark";

function resolveValue(raw: string, scheme: Scheme): string {
  const value = raw.trim();

  const lightDark = value.match(/^light-dark\((.*)\)$/s);
  if (lightDark) {
    const [light, dark] = splitTopLevel(lightDark[1]);
    return resolveValue(scheme === "light" ? light : dark, scheme);
  }

  const varRef = value.match(/^var\((--[\w-]+)(?:,.*)?\)$/s);
  if (varRef) {
    const name = varRef[1];
    const referenced = decls.get(name);
    if (referenced === undefined) throw new Error(`--${name} not declared in :root`);
    return resolveValue(referenced, scheme);
  }

  const colorMix = value.match(/^color-mix\(\s*in\s+oklab\s*,\s*(.*)\)$/s);
  if (colorMix) {
    const [first, second] = splitTopLevel(colorMix[1]);
    const [firstColor, firstPct] = first.trim().split(/\s+/);
    const pct = firstPct ? Number(firstPct.replace("%", "")) : 50;
    const colorA = resolveValue(firstColor, scheme);
    if (second.trim() === "transparent") return colorA; // alpha ignored: not used for a solid-colour resolution here
    const colorB = resolveValue(second, scheme);
    return mixOklab(colorA, pct, colorB);
  }

  return value; // literal hex (or something we don't need to recurse into further)
}

function token(name: string, scheme: Scheme): string {
  const raw = decls.get(`--${name}`);
  if (raw === undefined) throw new Error(`--${name} not declared in :root`);
  return resolveValue(raw, scheme);
}

/** Standard (non-premultiplied, gamma-space) "over" compositing: how a
 * browser paints a translucent `background-color` on top of a solid one. */
function blendSrgb(hexFg: string, hexBg: string, alpha: number): string {
  const fg = hexToRgb(hexFg);
  const bg = hexToRgb(hexBg);
  const composite = fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;
  return toHex(composite);
}

/** Resolves `--<accent>-soft` (a `color-mix(in oklab, X pct%, transparent)`)
 * to the solid colour it renders as once composited over `backdrop`. */
function softComposite(accent: string, scheme: Scheme, backdrop: string): string {
  const raw = decls.get(`--${accent}-soft`);
  if (raw === undefined) throw new Error(`--${accent}-soft not declared in :root`);
  const match = raw.trim().match(/^color-mix\(\s*in\s+oklab\s*,\s*(.*)\)$/s);
  if (!match) throw new Error(`--${accent}-soft is not a color-mix(in oklab, ...) expression`);
  const [first, second] = splitTopLevel(match[1]);
  if (second.trim() !== "transparent") {
    throw new Error(`--${accent}-soft's second color-mix argument is not "transparent"`);
  }
  const [colorExpr, pctStr] = first.trim().split(/\s+/);
  const pct = Number(pctStr.replace("%", ""));
  const accentHex = resolveValue(colorExpr, scheme);
  const backdropHex = token(backdrop, scheme);
  return blendSrgb(accentHex, backdropHex, pct / 100);
}

const SCHEMES: Scheme[] = ["light", "dark"];
const ACCENTS = ["primary", "destructive", "attention", "warning", "success", "info"];

describe("theme tokens — WCAG AA contrast", () => {
  it.each(SCHEMES)("foreground and muted-foreground on background/card/field (%s)", (scheme) => {
    for (const fg of ["foreground", "muted-foreground"]) {
      for (const bg of ["background", "card", "field"]) {
        const ratio = contrast(token(fg, scheme), token(bg, scheme));
        expect(ratio, `--${fg} on --${bg} in ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(SCHEMES)("primary-foreground on primary (%s)", (scheme) => {
    const ratio = contrast(token("primary-foreground", scheme), token("primary", scheme));
    expect(ratio, `--primary-foreground on --primary in ${scheme}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("each accent (raw, non-text use) on background/card (%s)", (scheme) => {
    for (const accent of ACCENTS) {
      for (const bg of ["background", "card"]) {
        const ratio = contrast(token(accent, scheme), token(bg, scheme));
        expect(ratio, `--${accent} on --${bg} in ${scheme}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(SCHEMES)("each accent's -text token on background/card (%s)", (scheme) => {
    for (const accent of ACCENTS) {
      for (const bg of ["background", "card"]) {
        const ratio = contrast(token(`${accent}-text`, scheme), token(bg, scheme));
        expect(ratio, `--${accent}-text on --${bg} in ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(SCHEMES)("each accent's -text token on its own -soft tint, composited over background/card (%s)", (scheme) => {
    for (const accent of ACCENTS) {
      for (const bg of ["background", "card"]) {
        const ratio = contrast(token(`${accent}-text`, scheme), softComposite(accent, scheme, bg));
        expect(ratio, `--${accent}-text on --${accent}-soft over --${bg} in ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

// LayerList's invalid row (src/components/LayerList.tsx) paints
// bg-destructive/{10,15} under text-destructive-text: rest, then hover and
// selected. Tailwind composites the alpha over the sidebar (--card).
describe("invalid Layers row — destructive-text on its tints", () => {
  it.each(SCHEMES)("holds 4.5:1 on destructive at 10% and 15% over card (%s)", (scheme) => {
    for (const alpha of [0.1, 0.15]) {
      const tint = blendSrgb(token("destructive", scheme), token("card", scheme), alpha);
      const ratio = contrast(token("destructive-text", scheme), tint);
      expect(ratio, `--destructive-text on destructive/${alpha * 100} in ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// A selected invalid row (LayerList.tsx) draws a 1px inset ring over its red
// tint. The ring is the only cue that tells it from a hovered invalid row, so
// it needs the 3:1 non-text minimum against that tint. Tint and ring are read
// from the class string LayerList puts on that row, so changing either class
// changes what is checked.
const layerListSource = readFileSync(new URL("../src/components/LayerList.tsx", import.meta.url), "utf8");

function selectedInvalidRowClasses(): string[] {
  const match = layerListSource.match(/invalid && isSelected && "([^"]+)"/);
  if (!match) throw new Error("could not find the selected invalid row's classes in LayerList.tsx");
  return match[1].split(/\s+/);
}

/** The `bg-<token>[/<alpha>]` or `ring-<token>[/<alpha>]` colour class among
 * `classes`, as the token's colour and its alpha (1 when there is no /alpha). */
function colourClass(classes: string[], utility: "bg" | "ring", scheme: Scheme): { hex: string; alpha: number } {
  // ring-1 (width) and ring-inset are not colours.
  const pattern = new RegExp(`^${utility}-(?!inset$|\\d)([\\w-]+)(?:/(\\d+))?$`);
  for (const cls of classes) {
    const m = cls.match(pattern);
    if (m) return { hex: token(m[1], scheme), alpha: m[2] === undefined ? 1 : Number(m[2]) / 100 };
  }
  throw new Error(`no ${utility}-<colour> class in: ${classes.join(" ")}`);
}

describe("selected invalid Layers row: ring on its tint", () => {
  it.each(SCHEMES)("holds 3:1 against the tint, as LayerList paints them over the sidebar (%s)", (scheme) => {
    const classes = selectedInvalidRowClasses();
    const bg = colourClass(classes, "bg", scheme);
    const ringClass = colourClass(classes, "ring", scheme);
    const tint = blendSrgb(bg.hex, token("sidebar", scheme), bg.alpha);
    const ring = blendSrgb(ringClass.hex, tint, ringClass.alpha);
    const ratio = contrast(ring, tint);
    expect(ratio, `${classes.join(" ")} in ${scheme}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});

describe("semantic utilities — @theme inline exposure", () => {
  it("exposes --color-<accent>, --color-<accent>-text and --color-<accent>-soft for all six accents", () => {
    for (const accent of ACCENTS) {
      for (const suffix of ["", "-text", "-soft"]) {
        expect(css, `--color-${accent}${suffix} missing from @theme inline`).toContain(
          `--color-${accent}${suffix}:`,
        );
      }
    }
  });

  it("grep-style acceptance: the four new accent names appear at least 8 times", () => {
    const matches = css.match(/color-attention|color-warning|color-success|color-info/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });
});
