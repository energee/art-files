// exportPair.ts — the two-dialog export (artwork, then mask), pure of the
// dialog itself so the sequencing rule is testable: each dialog is titled
// with its place in the pair, and a cancel on the first skips the second.
// The printer needs both plates or neither; "partial" is the one outcome
// that violates that and the caller reports it as an error.

export type Save = (bytes: Uint8Array, name: string, title?: string) => Promise<boolean>;
export type PairOutcome = "saved" | "cancelled" | "partial";

export async function savePair(
  save: Save, art: Uint8Array | null, mask: Uint8Array | null,
  base: string, ext: string, kind: string,
): Promise<PairOutcome> {
  const pair = !!(art && mask);
  if (art && !await save(art, `${base}.${ext}`, pair ? `Export 1 of 2: Artwork ${kind}` : undefined))
    return "cancelled";
  if (mask && !await save(mask, `${base}-mask.${ext}`, pair ? `Export 2 of 2: Mask ${kind}` : undefined))
    return pair ? "partial" : "cancelled";
  return "saved";
}
