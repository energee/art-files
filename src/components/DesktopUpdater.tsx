// DesktopUpdater.tsx — checks signed Tauri releases, installs one in place
// with progress in the status bar, and relaunches when the operator chooses
// (Windows' installer closes the app itself, so it relaunches during install).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, RotateCw } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const AUTO_CHECK_DELAY_MS = 2_000;

type CheckResult =
  | { kind: "available"; update: Update }
  | { kind: "current" }
  | { kind: "disabled" }
  | { kind: "error"; message: string };

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; currentVersion: string; body?: string; date?: string }
  | { kind: "current" }
  | { kind: "disabled" }
  | { kind: "downloading"; version: string; downloaded: number; total?: number }
  /** Installed on disk; the running process is still the old version until relaunch. */
  | { kind: "installed"; version: string }
  | { kind: "error"; message: string };

async function checkForUpdate(): Promise<CheckResult> {
  try {
    // Local builds deliberately omit the release key. Avoid invoking a
    // half-configured updater while keeping its UI testable in `tauri dev`.
    if (!await invoke<boolean>("updater_enabled")) return { kind: "disabled" };
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 15_000 });
    return update ? { kind: "available", update } : { kind: "current" };
  } catch (error) {
    return { kind: "error", message: String(error) };
  }
}

// Release bodies arrive as markdown-ish text from the release feed (the
// CHANGELOG section, whose bullets wrap at 80 columns). Classify each line so
// the dialog can style headings and bullets without a markdown dependency;
// an indented line after a bullet is that bullet's continuation.
// ponytail: headings and bullets only; add a renderer if release notes ever
// use links or emphasis.
const HEADING_RE = /^#{1,6}\s+(.*)/;
const BULLET_RE = /^[-*]\s+(.*)/;

export function releaseNoteLines(body: string) {
  const out: { kind: "heading" | "bullet" | "text"; text: string }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = HEADING_RE.exec(line);
    const bullet = BULLET_RE.exec(line);
    const last = out.at(-1);
    if (heading) out.push({ kind: "heading", text: heading[1] });
    else if (bullet) out.push({ kind: "bullet", text: bullet[1] });
    else if (last?.kind === "bullet" && /^\s/.test(raw)) last.text += ` ${line}`;
    else out.push({ kind: "text", text: line });
  }
  return out;
}

const NOTE_CLASS = {
  heading: "pt-1.5 font-semibold first:pt-0",
  bullet: "relative pl-3 text-muted-foreground before:absolute before:left-0 before:content-['•']",
  text: "text-muted-foreground",
} as const;

/** Whole-number percent of the download in flight; undefined until the
 *  release's size is known. */
function downloadPct(downloaded: number, total?: number) {
  return total ? Math.min(100, Math.round(downloaded / total * 100)) : undefined;
}

function releaseUpdate(update: Update) {
  void update.close().catch((error) => {
    console.error(`Could not release the updater resource: ${String(error)}`);
  });
}

// Windows hands the download to the NSIS installer, which closes Label Lab
// itself, so "install now, restart later" only exists on macOS and Linux.
const INSTALL_EXITS_APP = /Windows/.test(navigator.userAgent);

export function DesktopUpdater(props: {
  dirty: boolean;
  checkRequest: number;
  statusHost?: HTMLElement | null;
  /** Fires with the version once an update is installed and awaiting a relaunch. */
  onInstalled?: () => void;
}) {
  const desktop = isTauri();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const updateRef = useRef<Update | null>(null);
  const checkRef = useRef<Promise<CheckResult> | null>(null);
  const mountedRef = useRef(true);
  const lastRequestRef = useRef(props.checkRequest);

  const dropUpdate = useCallback(() => {
    const update = updateRef.current;
    updateRef.current = null;
    if (update) releaseUpdate(update);
  }, []);

  const performCheck = useCallback(() => {
    if (checkRef.current) return checkRef.current;
    const operation = checkForUpdate();
    checkRef.current = operation;
    void operation.finally(() => {
      if (checkRef.current === operation) checkRef.current = null;
    });
    return operation;
  }, []);

  const present = useCallback((result: CheckResult, manual: boolean) => {
    if (!mountedRef.current) {
      if (result.kind === "available") releaseUpdate(result.update);
      return;
    }
    if (manual) setOpen(true);
    if (result.kind === "available") {
      if (updateRef.current && updateRef.current !== result.update) dropUpdate();
      updateRef.current = result.update;
      setStatus({
        kind: "available",
        version: result.update.version,
        currentVersion: result.update.currentVersion,
        body: result.update.body,
        date: result.update.date,
      });
    } else if (manual || result.kind === "current") {
      setStatus(result);
    } else if (result.kind === "error") {
      // Being offline at launch must not block label work. A manual check
      // shows this same error in the dialog instead.
      console.error(`Automatic update check failed: ${result.message}`);
    }
  }, [dropUpdate]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      dropUpdate();
    };
  }, [dropUpdate]);

  // A quiet launch check: available updates appear in the status bar. The short delay
  // keeps updater network work out of the editor's first-paint path.
  useEffect(() => {
    if (!desktop) return;
    const timer = window.setTimeout(() => {
      void performCheck().then((result) => present(result, false));
    }, AUTO_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [desktop, performCheck, present]);

  // macOS Label Lab menu → Check for Updates… requests a visible result even
  // when the current version is already latest or this is a local build.
  // Once an update is installed the same item reads "Restart to Update" and
  // opens the restart confirmation instead (updateRef stays set until then).
  useEffect(() => {
    if (!desktop || props.checkRequest === lastRequestRef.current) return;
    lastRequestRef.current = props.checkRequest;
    setOpen(true);
    if (updateRef.current) return;
    setStatus({ kind: "checking" });
    void performCheck().then((result) => present(result, true));
  }, [desktop, performCheck, present, props.checkRequest]);

  const dismiss = () => {
    setOpen(false);
    if (!["available", "current", "installed", "downloading"].includes(status.kind)) setStatus({ kind: "idle" });
  };

  const install = async () => {
    const update = updateRef.current;
    if (!update || status.kind !== "available") return;
    let downloaded = 0;
    let total: number | undefined;
    let shownPct = -1;
    const showProgress = (event: DownloadEvent) => {
      if (event.event === "Started") total = event.data.contentLength;
      if (event.event === "Progress") downloaded += event.data.chunkLength;
      if (event.event === "Finished" && total !== undefined) downloaded = total;
      // Chunk events arrive many times a second; re-render only when the
      // status-bar percentage actually changes.
      const pct = downloadPct(downloaded, total) ?? -1;
      if (event.event === "Progress" && pct === shownPct) return;
      shownPct = pct;
      setStatus({ kind: "downloading", version: update.version, downloaded, total });
    };
    setStatus({ kind: "downloading", version: update.version, downloaded: 0 });
    setOpen(false); // progress shows in the status bar; the dialog returns only on error
    try {
      await update.downloadAndInstall(showProgress, { timeout: 120_000 });
      if (INSTALL_EXITS_APP) { await invoke("relaunch_app"); return; }
      setStatus({ kind: "installed", version: update.version });
      props.onInstalled?.();
    } catch (error) {
      dropUpdate();
      setStatus({ kind: "error", message: `Could not install the update: ${String(error)}` });
      setOpen(true);
    }
  };

  const pct = status.kind === "downloading" ? downloadPct(status.downloaded, status.total) : undefined;
  // The two clickable status-bar states share one button; only icon and label differ.
  const barAction = status.kind === "available" ? { Icon: Download, label: "Update available", version: status.version }
    : status.kind === "installed" ? { Icon: RotateCw, label: "Restart to finish", version: status.version }
    : null;
  const releasedOn = status.kind === "available" && status.date
    ? ` · Released ${new Date(status.date).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      })}`
    : "";
  const busy = status.kind === "checking";

  return (
    <>
      {desktop && props.statusHost && status.kind === "current" && createPortal(
        <span role="status" className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          {/* Hugeicons CheckmarkCircle02Icon (core-free-icons, MIT). */}
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z" />
            <path d="M8 12.5L10.5 15L16 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg> Up-to-date
        </span>,
        props.statusHost,
      )}
      {desktop && props.statusHost && barAction && createPortal(
        <span role="status">
          <Button variant="ghost" size="sm" className="h-6 gap-1.5 px-2 text-xs text-primary"
            onClick={() => setOpen(true)}>
            <barAction.Icon data-icon="inline-start" aria-hidden="true" />
            {barAction.label} · {barAction.version}
          </Button>
        </span>, props.statusHost,
      )}
      {desktop && props.statusHost && status.kind === "downloading" && createPortal(
        <span role="status" aria-live="polite" className="inline-flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" aria-hidden />
          {pct === 100 ? "Finishing…" : `Installing ${status.version}${pct === undefined ? "…" : ` · ${pct}%`}`}
        </span>,
        props.statusHost,
      )}
    <Dialog open={open}
      onOpenChange={(open) => { if (!open && !busy) dismiss(); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {status.kind === "available" && "Update available"}
            {status.kind === "installed" && "Restart to finish updating"}
            {status.kind === "downloading" && `Installing Label Lab ${status.version}`}
            {status.kind === "checking" && "Checking for updates"}
            {status.kind === "current" && "Label Lab is up to date"}
            {status.kind === "disabled" && "Updates are not configured"}
            {status.kind === "error" && "Update failed"}
          </DialogTitle>
          <DialogDescription>
            {status.kind === "available" && `${status.currentVersion} → ${status.version}${releasedOn}`}
            {status.kind === "installed" && `Label Lab ${status.version} is installed and starts the next time the app opens.`}
            {status.kind === "downloading" && "The download is in progress; the status bar shows how far along it is."}
            {status.kind === "checking" && (
              <span className="flex items-center gap-2">
                <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" aria-hidden />
                Looking for the latest signed release…
              </span>
            )}
            {status.kind === "current" && "You already have the newest available version."}
            {status.kind === "disabled" && "Local builds do not contain the release signing key."}
            {status.kind === "error" && status.message}
          </DialogDescription>
        </DialogHeader>

        {status.kind === "available" && status.body && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">What's new</p>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md bg-muted p-3 text-xs">
              {releaseNoteLines(status.body).map((line, i) => (
                <p key={i} className={NOTE_CLASS[line.kind]}>{line.text}</p>
              ))}
            </div>
          </div>
        )}
        {(status.kind === "installed" || (status.kind === "available" && INSTALL_EXITS_APP)) && props.dirty && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            This label has unsaved changes. Restarting discards them, so choose Later and save first.
          </p>
        )}

        {status.kind === "available" && (
          <DialogFooter>
            <Button variant="outline" onClick={dismiss}>Later</Button>
            <Button onClick={() => void install()}>{INSTALL_EXITS_APP ? "Install and Restart" : "Install"}</Button>
          </DialogFooter>
        )}
        {status.kind === "installed" && (
          <DialogFooter>
            <Button variant="outline" onClick={dismiss}>Later</Button>
            <Button onClick={() => void invoke("relaunch_app").catch((error: unknown) => {
              setStatus({ kind: "error", message: `Could not restart: ${String(error)}` });
            })}>Restart Now</Button>
          </DialogFooter>
        )}
        {(status.kind === "current" || status.kind === "disabled" || status.kind === "error" || status.kind === "downloading") && (
          <DialogFooter>
            <Button onClick={dismiss}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
