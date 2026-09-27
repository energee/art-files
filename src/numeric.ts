// numeric.ts — the one rounding rule the numeric fields and the values they
// persist both have to obey. Deliberately dependency-free: ScrubField hands the
// step's decimals to Base UI's NumberField, and settings.ts and the 3D scene
// read the same rule without pulling a React component in.

/** Decimal places implied by a step (0.005 -> 3, 0.0005 -> 4).
 *
 *  ScrubField's NumberField rounds every typed or dragged value to this, so a drag cannot
 *  accumulate float noise (0.4 + 0.1 = 0.5000000000000001) into a saved config.
 *  Anything that has to PREDICT what a field will hand back — see settings'
 *  displayBleedIn/commitBleedIn — must round the same way off the same step, or
 *  the two disagree about whether a value changed. */
export const decimalsOf = (step: number) => (String(step).split(".")[1] ?? "").length;

/** `value` on the grid `step` implies — the rounding a numeric field applies
 *  to every typed or scrubbed number, for callers that write a number without
 *  going through a field (a pointer drag, a resize). */
export const roundToStep = (value: number, step: number) =>
  Number(value.toFixed(decimalsOf(step)));

/** The model's precision for positions and sizes, in PDF points: the Lolev
 *  master authors to hundredths (24.12, 15.83). The inspector types on it and
 *  a canvas drag lands on it, so both write the same numbers. */
export const PT_STEP = 0.01;
