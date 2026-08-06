// labelSettings.ts — the Document > Settings layer's contract, kept in its
// own module (no three.js import) so App and the inspector can hold these
// values without pulling the 3D bundle into the main chunk.
//
// Session state, deliberately outside the saved config and the print PDFs:
// these describe how the label is PRESENTED in the 3D views. The physical
// label is die-cut and sized at the press.

/** All percentages, so the UI and the scene agree on units; the scene
 *  converts to its own ratios internally. */
export interface LabelViewSettings {
  /** Die-cut corner radius, % of the label's short edge. */
  cornerRadiusPct: number;
  /** Label height, % of can height. */
  labelHeightPct: number;
  /** Foil-mask blur, % of label width. 0 leaves a hard specular outline
   *  around every metallic element that the physical print doesn't have. */
  edgeSoftnessPct: number;
}

/** One home for the defaults — App seeds its state from these and the scene
 *  starts here too, so the inspector can't report a value the scene isn't
 *  rendering. */
export const DEFAULT_LABEL_VIEW_SETTINGS: LabelViewSettings = {
  cornerRadiusPct: 2.5,
  labelHeightPct: 82,
  edgeSoftnessPct: 0.1,
};
