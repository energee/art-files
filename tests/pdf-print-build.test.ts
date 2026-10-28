import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildArtPdf, buildPrintPdf } from "../src/pdf/build";
import { assets, contentStreamText, lolevPlan } from "./fixtures";
import { setBleed, SHIPPED_BLEED_IN } from "../src/layout";

it("keeps the art pass unchanged, outlines the spot pass and builds deterministically", async () => {
  const items = await lolevPlan();
  const print = await buildPrintPdf(items, assets);
  expect(print).toEqual(await buildPrintPdf(items, assets));
  const stream = await contentStreamText(print);
  const marker = stream.indexOf("/OC /OCW BDC");
  expect(marker).toBeGreaterThan(0);
  expect(stream.slice(0, marker)).toBe(await contentStreamText(await buildArtPdf(items, assets)));
  const white = stream.slice(marker);
  expect(white).not.toMatch(/\b(?:rg|RG|g|G|BT|Tj|TJ)\b/);
  expect(white).toContain("1 scn");
  expect(white).toContain("0 scn");
  expect(white).toContain("SCN");
  expect(white.trimEnd()).toMatch(/Q\nEMC$/);
  expect((await PDFDocument.load(print)).getTitle()).toBe("Label label");
});

it("keeps the art pass identical with a non-default bleed", async () => {
  setBleed(0.125);
  try {
    const items = await lolevPlan();
    const stream = await contentStreamText(await buildPrintPdf(items, assets));
    expect(stream.slice(0, stream.indexOf("/OC /OCW BDC")))
      .toBe(await contentStreamText(await buildArtPdf(items, assets)));
  } finally { setBleed(SHIPPED_BLEED_IN); }
});
