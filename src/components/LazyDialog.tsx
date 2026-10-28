// LazyDialog.tsx — what a dialog that loads on first open (#410: Settings,
// the Save Master review, the ⌘K palette) shows before its own chunk
// renders: DialogLoading while the chunk loads, the load-failed message if
// it never does.
import { t, useTranslation } from "@/i18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errMsg } from "@/lib/utils";

/** The Suspense fallback while an opened dialog's chunk loads. Invisible,
 *  but it carries the dialog-content marker dialogOpen() looks for, so the
 *  ⌘ shortcuts, bare keys and arrow nudge stay off the tab behind a dialog
 *  the user has already asked for (#244), as they did from the dialog's
 *  first frame before it was split out. */
export const DialogLoading = () => <div data-slot="dialog-content" hidden />;

/** React.lazy keeps a failed load for the rest of the session, so the
 *  message names the way out. */
export const loadFailedMessage = (what: string, err: unknown) =>
  t("{{what}} failed to load: {{error}}. Save your work and reload Label Lab to try again.", { what, error: errMsg(err) });

/** Stands in for a dialog whose chunk failed to load, instead of
 *  unmounting the editor and its unsaved edits. */
export function DialogLoadFailed({ title, what, err, open, onOpenChange }: {
  title: string; what: string; err: unknown; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("{{what}} failed to load: {{error}}. Save your work and reload Label Lab to try again.", { what, error: errMsg(err) })}</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
