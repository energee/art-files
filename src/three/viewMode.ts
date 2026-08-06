// viewMode.ts — the set of previews the app can show, declared once so App's
// View menu, its 1-5 keyboard map and the command palette cannot drift from
// what the 3D scene actually implements. Separate from canScene.ts (and free
// of its three.js import) so App can name a mode without pulling the 3D
// bundle into the main chunk.

/** The three.js scene's modes. */
export type CanSceneMode = "can" | "pack" | "flat";

/** Every preview: the 2D PDF compare plus the scene's modes. */
export type ViewMode = "2d" | CanSceneMode;
