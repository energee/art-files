// notify.ts — the one door every user-facing message goes through. A thin
// wrapper over Sonner's `toast` that decides, per kind, how long a toast stays,
// so no caller picks a duration of its own. Success fades quickly and info
// lingers long enough to read an Undo; warnings and errors report something the
// user must see, so they stay until dismissed and always carry a close button.
// Pass an `id` to make a toast replaceable and dismissible: showing a second
// toast with the same id updates the first rather than stacking another.
// Screen readers hear every toast once, politely, from Sonner's own
// aria-live="polite" region; nothing here adds a second live region.
import { toast } from "sonner";

export type ToastAction = { label: string; onClick: () => void };
/** `onDismiss` runs when the toast is closed with its close button, swiped
 *  away, or dismissed with `notify.dismiss` — so a caller that dismisses its own
 *  toast must tell that apart from the user closing it (by id). It does not run
 *  when a success/info toast fades or when its action is clicked. */
export type NotifyOptions = { id?: string; description?: string; action?: ToastAction; onDismiss?: () => void };

/** How long (ms) the kinds that fade stay on screen. */
export const TOAST_MS = { success: 4000, info: 8000 } as const;

/** Warnings and errors stay until the user closes them. */
const STAYS = { duration: Infinity, closeButton: true } as const;

export const notify = {
  success: (title: string, opts?: NotifyOptions) => toast.success(title, { ...opts, duration: TOAST_MS.success }),
  info: (title: string, opts?: NotifyOptions) => toast.info(title, { ...opts, duration: TOAST_MS.info }),
  warning: (title: string, opts?: NotifyOptions) => toast.warning(title, { ...opts, ...STAYS }),
  // Polite like the rest: Sonner's live section has no per-toast override, so a
  // role="alert" on the title (or a mirror outside it) reads the error twice.
  // Assertive would mean turning that section off and rebuilding its announcements.
  error: (title: string, opts?: NotifyOptions) => toast.error(title, { ...opts, ...STAYS }),
  dismiss: (id: string) => { toast.dismiss(id); },
};
