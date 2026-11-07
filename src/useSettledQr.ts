// useSettledQr.ts — the layers the 2D preview and the die check plan from:
// the draw layers with each QR held at its last settled value while its
// payload is changing. Encoding a QR is the costliest part of a plan, so a
// field that feeds the QR URL would otherwise re-encode it per keystroke
// (#722). Preview only: the exports and the 3D view (its own debounce) plan
// from the live layers, so nothing built ever carries a stale code.
import { useEffect, useMemo, useState } from "react";
import type { Layer } from "@/model/layers";

/** Longer than the gap between keystrokes, or it would fire on each one. */
const QR_SETTLE_MS = 300;

export function useSettledQr(layers: Layer[]): Layer[] {
  const live = JSON.stringify(layers.flatMap((l) => l.kind === "qr" ? [[l.id, l.value]] : []));
  const [settled, setSettled] = useState(live);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(live), QR_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [live]);
  return useMemo(() => {
    if (settled === live) return layers;
    const shown = new Map<string, string>(JSON.parse(settled));
    return layers.map((l) => l.kind === "qr" && shown.has(l.id) ? { ...l, value: shown.get(l.id)! } : l);
  }, [layers, settled, live]);
}
