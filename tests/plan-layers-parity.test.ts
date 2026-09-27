// plan-layers-parity.test.ts — the spec's re-baseline evidence: the Lolev
// label planned the OLD way (planLabel over a LabelConfig and layout.ts's
// hardcoded constants) and the NEW way (planLayers over model/lolevLayers'
// v3 data) land every element's geometry within 0.25pt of each other,
// measured with the real Poppins metrics the PDF backend draws with.
//
// The v3 side is lolevMaster()'s own layers with the label's VALUES filled
// in by hand (name, style, abv, description, upc, the expanded QR payload —
// the resolver's job, not the renderer's) and the collab variant's three
// layers merged in by hand.
//
// DATA GAPS — things the committed lolevLayers.ts cannot say yet and this
// test patches in (see `withGaps`). Each is reported, not hidden:
//   1. Face weights. TextLayer has no weight field; planLayers reads an
//      optional `faces: { base, bold }` (planLayers.ts's TextFaces, default
//      regular/semibold). Today's label sets the wordmark, name and STORE
//      COLD in Bold, the Info line in SemiBold with a Bold handle, and the
//      warning's "GOVERNMENT WARNING:" in Bold over a Regular body. Without
//      the field those five draw in the default pair and the centred lines
//      shift by ~0.5-1pt (Bold is wider), the Info run shrinks ~10pt.
//   2. collabLead's two lines draw bold today (planLabel adds bold: true);
//      the data's lines carry no bold flag.
//   3. The QR draws the "dots" style at EC level L today (qrShapes'
//      defaults); the data says qrStyle: "square". planLayers defaults an
//      absent ecLevel to "L".
//
// KNOWN DELTA (asserted below, not papered over): `align: "justify"`
// leaves the LAST line at its natural length, per the spec ("justify on a
// last/only line degrades to left"). Today's warning justifies every
// column, including the last, so all four columns share the top guide
// (layout.ts's WARNING note). The 4th column's natural length is ~26pt
// short of maxLen with the shipped text, so its top now sits that much
// below the guide. Columns 1-3 match exactly.
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { planLabel } from "./legacy/plan";
import { type MeasureFace, type Placed, type PlacedText, type PlacedBarcode, type PlacedPaths, type PlacedImage } from "./legacy/planShared";
import { planLayers, type PlacedLayer, type TextFaces } from "../src/planLayers";
import { lolevMaster } from "../src/model/lolevLayers";
import type { Layer, QrLayer, TextLayer, TextLine } from "../src/model/layers";
import { defaultConfig } from "../src/defaults";
import { qrUrl } from "../src/qr";
import { GOLD } from "./legacy/layout";
import * as L from "./legacy/layout";
import { assets as fixture } from "./fixtures";

const TOL = 0.25;
const NAME = "Peregrine Falcon";
const STYLE = "Hazy IPA";
const ABV = "6.5";
const UPC = "850051366224";
const DESC_2 = ["Citra, Mosaic", "Strata"];
const DESC_5 = ["Citra, Mosaic", "Strata", "Nelson", "Galaxy", "Simcoe"];

const gm = { fill: GOLD, layer: "metallic" } as const;
const line = (text: string, extra: Partial<TextLine> = {}): TextLine => ({ text, ...gm, ...extra });

let m: MeasureFace;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = {
    regular: await doc.embedFont(fixture.fonts.regular),
    semibold: await doc.embedFont(fixture.fonts.semibold),
    bold: await doc.embedFont(fixture.fonts.bold),
  };
  m = (t, size, face) => fonts[face].widthOfTextAtSize(t, size);
});

// --- the old way ------------------------------------------------------------

const RASTER = { kind: "raster" as const, w: 200, h: 100 };

function oldPlan(bodyLines: string[], collab: boolean): Placed[] {
  const cfg = defaultConfig();
  cfg.beerName = NAME;
  cfg.styleLine.text = STYLE;
  cfg.abv = ABV;
  cfg.upc = UPC;
  cfg.description = ["# HOPS", ...bodyLines].join("\n");
  return planLabel(cfg, m, {
    collab: { left: collab, center: collab },
    assets: {
      logoSvg: fixture.logoSvg,
      collabLeft: collab ? RASTER : null, collabCenter: collab ? RASTER : null,
    },
  });
}

// --- the new way ------------------------------------------------------------

const FACES: Record<string, TextFaces> = {
  wordmark: { base: "bold", bold: "bold" },
  name: { base: "bold", bold: "bold" },
  storeCold: { base: "bold", bold: "bold" },
  handleAddress: { base: "semibold", bold: "bold" },
  warning: { base: "regular", bold: "bold" },
};

/** The data gaps listed in the header, patched onto a copy of the layers. */
function withGaps(layers: Layer[]): Layer[] {
  return layers.map((l) => {
    if (l.kind === "text" && FACES[l.id]) return { ...l, faces: FACES[l.id] } as Layer;
    if (l.id === "collabLead" && l.kind === "text")
      return { ...l, lines: l.lines.map((x) => ({ ...x, bold: true })) };
    if (l.kind === "qr") return { ...l, qrStyle: "dots", ecLevel: "L" } as QrLayer;
    return l;
  });
}

function newLayers(bodyLines: string[], collab: boolean): Layer[] {
  const master = lolevMaster();
  const values: Record<string, TextLine[]> = {
    name: [line(NAME)], styleLine: [line(STYLE)], abv: [line(ABV)],
    description: [line("HOPS", { header: true }), ...bodyLines.map((t) => line(t))],
  };
  const filled = master.layers.map((l): Layer => {
    if (l.kind === "text" && values[l.id]) return { ...l, lines: values[l.id] };
    if (l.kind === "barcode") return { ...l, value: UPC };
    if (l.kind === "qr") return { ...l, value: qrUrl(NAME) };
    return l;
  });
  const variant = master.variants.find((v) => v.id === "collab")!;
  const collabLayers = collab
    ? Object.values(variant.layers).map((l): Layer => {
        const layer = l as Layer;
        if (layer.kind === "image") return { ...layer, asset: `${layer.id}-art` };
        return layer;
      })
    : [];
  return withGaps([...filled, ...collabLayers]);
}

function newPlan(bodyLines: string[], collab: boolean): PlacedLayer[] {
  return planLayers(newLayers(bodyLines, collab), m, {
    logoSvg: fixture.logoSvg,
    custom: { "collabLeft-art": { aspect: 2 }, "collabCenter-art": { aspect: 2 } },
  });
}

// --- comparison ---------------------------------------------------------------

const textsOf = (items: readonly { kind: string; id: string }[], id: string) =>
  items.filter((r): r is PlacedText => r.kind === "text" && r.id === id);

/** Same runs in the same order: text, face, size, tracking, rotation
 *  exactly; x, y, w within TOL. */
function expectSameRuns(a: PlacedText[], b: PlacedText[]) {
  expect(b.map((r) => r.text)).toEqual(a.map((r) => r.text));
  a.forEach((r, i) => {
    const s = b[i];
    expect([s.face, s.size, s.tracking, s.rotated, s.fill, s.layer, s.stroke])
      .toEqual([r.face, r.size, r.tracking, r.rotated, r.fill, r.layer, r.stroke]);
    expect(Math.abs(s.x - r.x), `${r.id} "${r.text}" x`).toBeLessThanOrEqual(TOL);
    expect(Math.abs(s.y - r.y), `${r.id} "${r.text}" y`).toBeLessThanOrEqual(TOL);
    expect(Math.abs(s.w - r.w), `${r.id} "${r.text}" w`).toBeLessThanOrEqual(TOL);
  });
}

const TEXT_IDS = ["volume", "abv", "description", "wordmark", "name", "styleLine", "handleAddress", "storeCold"];

describe("Lolev parity: planLabel vs planLayers", () => {
  it("every unrotated text element and the two single-column rotated ones match run for run", () => {
    const a = oldPlan(DESC_2, false);
    const b = newPlan(DESC_2, false);
    for (const id of TEXT_IDS) {
      const runs = textsOf(a, id);
      expect(runs.length, id).toBeGreaterThan(0);
      expectSameRuns(runs, textsOf(b, id));
    }
  });

  it("the warning wraps to the same columns; columns 1-3 justify identically", () => {
    const a = textsOf(oldPlan(DESC_2, false), "warning");
    const b = textsOf(newPlan(DESC_2, false), "warning");
    const columns = (runs: PlacedText[]) => [...new Set(runs.map((r) => r.x))];
    const ax = columns(a);
    const bx = columns(b);
    expect(ax).toHaveLength(4);
    expect(bx.map((x) => +x.toFixed(2))).toEqual(ax.map((x) => +x.toFixed(2)));
    // Same words in the same columns (a justified column is one run per
    // word, an unjustified one a single run — compare the joined text).
    const column = (runs: PlacedText[], x: number) => runs.filter((r) => Math.abs(r.x - x) < 1e-6);
    const words = (runs: PlacedText[], xs: number[]) => xs.map((x) => column(runs, x).map((r) => r.text).join(" "));
    expect(words(b, bx)).toEqual(words(a, ax));
    for (let c = 0; c < 3; c++) expectSameRuns(column(a, ax[c]), column(b, bx[c]));
  });

  it("KNOWN DELTA: the last warning column is left at its natural length, not justified", () => {
    const a = textsOf(oldPlan(DESC_2, false), "warning");
    const b = textsOf(newPlan(DESC_2, false), "warning");
    const lastX = Math.max(...a.map((r) => r.x));
    const oldCol = a.filter((r) => r.x === lastX);
    const [newRun, ...rest] = b.filter((r) => Math.abs(r.x - lastX) < 1e-6);
    expect(rest).toEqual([]); // one unjustified run, no markers in that column
    // Both start at the bottom margin; the old column reaches maxLen, the
    // new one its own tracked length.
    expect(newRun.y).toBeCloseTo(oldCol[0].y, 5);
    const oldEnd = oldCol[oldCol.length - 1];
    expect(oldCol[0].y - (oldEnd.y - oldEnd.w)).toBeCloseTo(L.WARNING.maxLen, 5);
    expect(newRun.w).toBeCloseTo(
      L.trackedWidth(m(newRun.text, L.WARNING.size, "regular"), newRun.text, L.WARNING_TRACKING), 5);
    // The documented magnitude with the shipped text and Poppins: ~26pt
    // short of the top guide.
    const shortfall = L.WARNING.maxLen - newRun.w;
    expect(shortfall).toBeGreaterThan(20);
    expect(shortfall).toBeLessThan(32);
  });

  it("the laurel, QR and barcode match", () => {
    const a = oldPlan(DESC_2, false);
    const b = newPlan(DESC_2, false);
    const paths = (items: readonly { kind: string; id: string }[], id: string) =>
      items.filter((r): r is PlacedPaths => r.kind === "paths" && r.id === id);
    const [logoA] = paths(a, "logo");
    const [logoB] = paths(b, "logo");
    expect(logoB.paths).toEqual(logoA.paths);
    expect(Math.abs(logoB.x - logoA.x)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(logoB.y - logoA.y)).toBeLessThanOrEqual(TOL);
    expect([logoB.fill, logoB.layer, logoB.stroke]).toEqual([logoA.fill, logoA.layer, logoA.stroke]);

    const qrA = paths(a, "qr");
    const qrB = paths(b, "qr");
    expect(qrB).toHaveLength(qrA.length);
    qrA.forEach((p, i) => {
      expect(qrB[i].paths).toEqual(p.paths);
      expect([qrB[i].x, qrB[i].y, qrB[i].fill, qrB[i].layer]).toEqual([p.x, p.y, p.fill, p.layer]);
    });

    const bcA = a.find((r): r is PlacedBarcode => r.kind === "barcode")!;
    const bcB = b.find((r): r is PlacedBarcode => r.kind === "barcode")!;
    expect([bcB.rotated, bcB.fill, bcB.stroke, bcB.fillLayer, bcB.strokeLayer])
      .toEqual([bcA.rotated, bcA.fill, bcA.stroke, bcA.fillLayer, bcA.strokeLayer]);
    expect(bcB.S).toBeCloseTo(bcA.S, 5);
    expect(bcB.textSize).toBeCloseTo(bcA.textSize, 5);
    expect(bcB.geo.bars).toHaveLength(bcA.geo.bars.length);
    bcA.geo.bars.forEach((r, i) => {
      const s = bcB.geo.bars[i];
      for (const k of ["x", "yTop", "w", "h"] as const) expect(Math.abs(s[k] - r[k])).toBeLessThanOrEqual(TOL);
    });
    expect(bcB.digits.map((d) => d.text)).toEqual(bcA.digits.map((d) => d.text));
    bcA.digits.forEach((r, i) => {
      const s = bcB.digits[i];
      for (const k of ["x", "y", "w"] as const) expect(Math.abs(s[k] - r[k])).toBeLessThanOrEqual(TOL);
    });
    expect(bcB.footprint).toHaveLength(bcA.footprint.length);
    bcA.footprint.forEach((r, i) => {
      const s = bcB.footprint[i];
      for (const k of ["x", "yTop", "w", "h"] as const) expect(Math.abs(s[k] - r[k])).toBeLessThanOrEqual(TOL);
    });
  });

  it.each([["2-line", DESC_2], ["5-line", DESC_5]] as const)(
    "collab (%s description): lead-in baselines, left slot top and centre slot top match", (_, body) => {
      const a = oldPlan([...body], true);
      const b = newPlan([...body], true);
      expectSameRuns(textsOf(a, "description"), textsOf(b, "description"));
      const lead = textsOf(a, "collabLead");
      expect(lead).toHaveLength(2);
      expectSameRuns(lead, textsOf(b, "collabLead"));
      const img = (items: readonly { kind: string; id: string }[], id: string) =>
        items.find((r): r is PlacedImage => r.kind === "image" && r.id === id)!;
      for (const id of ["collabLeft", "collabCenter"]) {
        const ia = img(a, id);
        const ib = img(b, id);
        expect(ia, id).toBeDefined();
        expect(ib, id).toBeDefined();
        for (const k of ["x", "y", "w", "h"] as const)
          expect(Math.abs(ib[k] - ia[k]), `${id} ${k}`).toBeLessThanOrEqual(TOL);
      }
    },
  );

  it("the centre slot hangs off the laurel, so a longer description leaves it put", () => {
    const top = (items: PlacedLayer[]) => items.find((r) => r.kind === "image" && r.id === "collabCenter")! as PlacedImage;
    expect(top(newPlan(DESC_5, true)).y).toBeCloseTo(top(newPlan(DESC_2, true)).y, 5);
    const leftTop = (items: PlacedLayer[]) => (items.find((r) => r.kind === "image" && r.id === "collabLeft") as PlacedImage).y;
    expect(leftTop(newPlan(DESC_5, true)) - leftTop(newPlan(DESC_2, true))).toBeCloseTo(3 * L.DESC.leading, 5);
  });

  it("the rotated column boxes' left edges are the layout's baselines less one ascender", () => {
    // The data corrections this parity pass made: LayerBase.x is a box
    // edge, the layout's constants were baselines.
    const byId = Object.fromEntries(lolevMaster().layers.map((l) => [l.id, l])) as Record<string, TextLayer>;
    expect(byId.handleAddress.x).toBeCloseTo(L.HANDLE_ADDR.x - L.FONT_ASC * L.HANDLE_ADDR.size, 5);
    expect(byId.warning.x).toBeCloseTo(L.WARNING.x - L.FONT_ASC * L.WARNING.size, 5);
    expect(byId.storeCold.x).toBeCloseTo(L.STORE_COLD.x - L.FONT_ASC * L.STORE_COLD.size, 5);
  });
});
