// tests/viewport.ts — resize happy-dom's window. Its matchMedia lists
// re-evaluate against the new size and fire "change", as a browser's do.
export function setViewport(width: number, height: number): void {
  (window as unknown as { happyDOM: { setViewport(size: { width: number; height: number }): void } })
    .happyDOM.setViewport({ width, height });
}
