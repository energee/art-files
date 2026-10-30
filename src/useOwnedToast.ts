// useOwnedToast.ts — a message toast owned by one source and one tab. Each
// caller of the hook gets its own toast (its own id), so a writer replaces or
// clears only the message it set itself and never wipes one another source put
// up (#473 exports, #511 asset assembly — the rule useOwnedError.ts keeps for
// the header message slots). The toast shows only while its tab is active:
// leaving the tab dismisses it, coming back shows it again, and a message set
// while the tab is hidden waits for the tab. It stays until cleared, and goes
// when its owner unmounts.
import { useEffect, useId, useMemo, useRef } from "react";
import { notify, type NotifyOptions } from "@/notify";

export type OwnedKind = "error" | "warning";
type OwnedOpts = Pick<NotifyOptions, "description" | "action">;
type Message = { text: string; kind: OwnedKind; opts?: OwnedOpts };

const show = (id: string, { text, kind, opts }: Message) => notify[kind](text, { ...opts, id });

export function useOwnedToast(active: boolean): {
  set: (text: string, kind?: OwnedKind, opts?: OwnedOpts) => void;
  clear: () => void;
} {
  const id = useId();
  const message = useRef<Message | null>(null);
  const tabActive = useRef(active);

  // Shows the remembered message while the tab is active; the cleanup hides it
  // when the tab goes inactive and when the owner unmounts.
  useEffect(() => {
    tabActive.current = active;
    if (active && message.current) show(id, message.current);
    return () => notify.dismiss(id);
  }, [active, id]);

  return useMemo(() => ({
    set(text: string, kind: OwnedKind = "error", opts?: OwnedOpts) {
      message.current = { text, kind, opts };
      if (tabActive.current) show(id, message.current);
    },
    clear() {
      message.current = null;
      notify.dismiss(id);
    },
  }), [id]);
}
