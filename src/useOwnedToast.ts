// useOwnedToast.ts — a message toast owned by one source and one tab. Each
// caller of the hook gets its own toast, so a writer replaces or clears only
// the message it set itself and never wipes one another source put up (#473
// exports, #511 asset assembly). A message stays until its owner clears it or
// the user closes it (close button, swipe, or clicking its action); a message
// the user closed is forgotten and does not come back. The toast shows only
// while its tab is active: leaving the tab hides it but keeps the message,
// coming back shows it again, and a message set while the tab is hidden waits
// for the tab. When the owner unmounts the toast goes, and a later set() shows
// nothing.
import { useEffect, useId, useMemo, useRef } from "react";
import { notify, type NotifyOptions } from "@/notify";

export type OwnedKind = "error" | "warning";
type OwnedOpts = Pick<NotifyOptions, "description" | "action">;
type Message = { text: string; kind: OwnedKind; opts?: OwnedOpts };

export function useOwnedToast(active: boolean): {
  set: (text: string, kind?: OwnedKind, opts?: OwnedOpts) => void;
  clear: () => void;
} {
  const base = useId();
  const message = useRef<Message | null>(null);
  const tabActive = useRef(active);
  // Sonner keeps a dismissed toast's entry for ~250 ms and folds a toast shown
  // under the same id into it, where it vanishes with the old one. So every
  // toast after a dismissal or a user close gets a fresh id, bumped here.
  const generation = useRef(0);

  const own = useMemo(() => {
    const currentId = () => `${base}-${generation.current}`;
    const retire = () => { generation.current += 1; };
    // Sonner also calls onDismiss for the hook's own notify.dismiss, which has
    // already retired its id by the time it lands, so only a user close matches.
    const closedByUser = (id: string) => {
      if (id !== currentId()) return;
      message.current = null;
      retire();
    };
    return {
      show({ text, kind, opts }: Message) {
        const id = currentId();
        const action = opts?.action;
        // Both fields are named even when absent: a toast shown under an id that
        // is already on screen is merged into it, so an omitted field would keep
        // the previous message's.
        notify[kind](text, {
          id,
          description: opts?.description,
          // Sonner closes the toast after an action but does not call onDismiss
          // for it. Forget first: the action may set() a new message.
          action: action && { label: action.label, onClick: () => { closedByUser(id); action.onClick(); } },
          onDismiss: () => closedByUser(id),
        });
      },
      hide() {
        notify.dismiss(currentId());
        retire();
      },
    };
  }, [base]);

  // Shows the remembered message while the tab is active. The cleanup runs when
  // the tab goes inactive and on unmount: it hides the toast but keeps the
  // message, and marks the tab inactive so a set() after unmount stays quiet
  // (the next run sets it again, so tab flips and StrictMode's second pass work).
  useEffect(() => {
    tabActive.current = active;
    if (active && message.current) own.show(message.current);
    return () => {
      tabActive.current = false;
      own.hide();
    };
  }, [active, own]);

  return useMemo(() => ({
    set(text: string, kind: OwnedKind = "error", opts?: OwnedOpts) {
      message.current = { text, kind, opts };
      if (tabActive.current) own.show(message.current);
    },
    clear() {
      message.current = null;
      own.hide();
    },
  }), [own]);
}
