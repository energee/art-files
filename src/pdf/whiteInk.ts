// whiteInk.ts — the printer's White Ink spot layer: colour space, overprint
// state, and optional-content layer for the combined print PDF.
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  PDFRef,
  PDFString,
} from "pdf-lib";

/** The printer-required spot swatch and optional-content layer name. */
export const WHITE_INK = "White Ink";

const colorSpaces = new WeakMap<PDFDocument, PDFRef>();

function whiteInkColorSpace(doc: PDFDocument): PDFRef {
  const existing = colorSpaces.get(doc);
  if (existing) return existing;

  const colorSpace = doc.context.obj([
    PDFName.of("Separation"),
    PDFName.of(WHITE_INK),
    PDFName.of("DeviceCMYK"),
    {
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: [0, 1, 0, 0],
      N: 1,
    },
  ]);
  const ref = doc.context.register(colorSpace);
  colorSpaces.set(doc, ref);
  return ref;
}

/**
 * Installs the printer-required Separation colour space, overprint state, and
 * visible optional-content layer on `page`. The returned operators bracket the
 * white-ink drawing pass.
 */
export function registerWhiteInk(doc: PDFDocument, page: PDFPage): {
  begin: PDFOperator[];
  end: PDFOperator[];
} {
  const colorSpace = whiteInkColorSpace(doc);
  const graphicsState = doc.context.register(doc.context.obj({ OP: true, op: true, OPM: 1 }));
  const ocg = doc.context.register(doc.context.obj({
    Type: "OCG",
    Name: PDFString.of(WHITE_INK),
  }));

  const resources = page.node.Resources() ?? doc.context.obj({});
  if (!page.node.Resources()) page.node.set(PDFName.of("Resources"), resources);
  let spaces = resources.lookupMaybe(PDFName.of("ColorSpace"), PDFDict);
  if (!spaces) {
    spaces = doc.context.obj({});
    resources.set(PDFName.of("ColorSpace"), spaces);
  }
  spaces.set(PDFName.of("CSW"), colorSpace);
  page.node.setExtGState(PDFName.of("GSW"), graphicsState);

  let properties = resources.lookupMaybe(PDFName.of("Properties"), PDFDict);
  if (!properties) {
    properties = doc.context.obj({});
    resources.set(PDFName.of("Properties"), properties);
  }
  properties.set(PDFName.of("OCW"), ocg);

  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({
    OCGs: [ocg],
    D: { Order: [ocg], ON: [ocg] },
  }));

  return {
    begin: [
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of("OC"), PDFName.of("OCW")]),
      PDFOperator.of(PDFOperatorNames.PushGraphicsState),
      PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams, [PDFName.of("GSW")]),
    ],
    end: [
      PDFOperator.of(PDFOperatorNames.PopGraphicsState),
      PDFOperator.of(PDFOperatorNames.EndMarkedContent),
    ],
  };
}

/** Selects the White Ink Separation and paints a non-stroking tint. */
export function whiteFill(tint: 0 | 1): PDFOperator[] {
  return [
    PDFOperator.of(PDFOperatorNames.NonStrokingColorspace, [PDFName.of("CSW")]),
    PDFOperator.of(PDFOperatorNames.NonStrokingColorN, [PDFNumber.of(tint)]),
  ];
}

/** Selects the White Ink Separation and paints a stroking tint. */
export function whiteStroke(tint: 0 | 1): PDFOperator[] {
  return [
    PDFOperator.of(PDFOperatorNames.StrokingColorspace, [PDFName.of("CSW")]),
    PDFOperator.of(PDFOperatorNames.StrokingColorN, [PDFNumber.of(tint)]),
  ];
}

/**
 * Embeds decoded RGBA mask pixels as one Separation sample per pixel. Red is
 * inverted because the legacy mask's blue is R=0 (full ink) and white R=255
 * is a knockout. Alpha is intentionally ignored, matching the legacy plate.
 */
export function embedWhiteInkMask(
  doc: PDFDocument,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): PDFRef {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error("White Ink mask dimensions must be positive integers");
  if (rgba.length !== width * height * 4)
    throw new Error("White Ink mask RGBA data length does not match its dimensions");

  const tints = new Uint8Array(width * height);
  for (let source = 0, pixel = 0; pixel < tints.length; source += 4, pixel++)
    tints[pixel] = 255 - rgba[source];

  return doc.context.register(doc.context.flateStream(tints, {
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    ColorSpace: whiteInkColorSpace(doc),
    BitsPerComponent: 8,
  }));
}
