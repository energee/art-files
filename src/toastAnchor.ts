// toastAnchor.ts — keeps the toast stack over the active tab's preview pane.
// The stack's CSS (src/index.css) reads --toast-center-x and --toast-bottom
// from <html>; this hook writes them from the pane's rect, so toasts sit
// centred over the preview, just above the zoom/view toolbar under it, and
// clear of the sidebars and the inspector sheet.
import { useEffect, type RefObject } from "react";

/** Space (px) between the stack and the pane's bottom edge. */
const GAP_PX = 8;

/** While `active`, point the toast stack at `pane` and follow its resizes.
 *  Every open tab is its own editor but there is one stack, so an inactive
 *  editor never writes; the tab that becomes active writes its own pane. */
export function usePreviewToastAnchor(pane: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const el = pane.current;
    if (!active || !el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const style = document.documentElement.style;
      style.setProperty("--toast-center-x", `${r.left + r.width / 2}px`);
      style.setProperty("--toast-bottom", `${window.innerHeight - r.bottom + GAP_PX}px`);
    };
    place();
    // The pane resizes with the sidebars and the inspector sheet's margin; the
    // window's own resize also moves its bottom and left edges.
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [pane, active]);
}
