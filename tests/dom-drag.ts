// dom-drag.ts — shared fake OS file drags for the happy-dom drop tests.
// happy-dom's DataTransfer can't carry OS files, so a minimal stand-in shaped
// like a Finder drag (types includes "Files") is attached to a plain Event.
import { act } from "react";

export function fileDrag(
  type: "dragenter" | "dragover" | "dragleave" | "drop", file: File, target: EventTarget = document.body,
): DragEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", {
    value: { types: ["Files"], items: [{ kind: "file", type: file.type }], files: [file] },
  });
  Object.defineProperty(e, "clientX", { value: 10 });
  act(() => { target.dispatchEvent(e); });
  return e;
}

/** Mount a FileDrop-marked well for a test; remove it when done. */
export function fieldWell(attr: string): HTMLDivElement {
  const field = document.createElement("div");
  field.setAttribute(attr, "");
  document.body.appendChild(field);
  return field;
}

export const pdf = new File(["%PDF"], "art.pdf", { type: "application/pdf" });
export const label = new File(["PK"], "beer.label", { type: "" });
export const png = new File(["png"], "rock.png", { type: "image/png" });
