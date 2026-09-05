// DesktopUpdater.tsx — checks signed Tauri releases and installs one only
// after the operator accepts the restart.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
  | { kind: "available"; version: string; body?: string; date?: string }
  | { kind: "current" }
  | { kind: "disabled" }
  | { kind: "downloading"; version: string; downloaded: number; total?: number }
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

// Release bodies arrive as markdown-ish text from the release feed. Classify
// each line so the dialog can style headings and bullets without a markdown
// dependency. ponytail: headings and bullets only; add a renderer if release
// notes ever use links or emphasis.
const HEADING_RE = /^#{1,6}\s+(.*)/;
const BULLET_RE = /^[-*]\s+(.*)/;

export function releaseNoteLines(body: string) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): { kind: "heading" | "bullet" | "text"; text: string } => {
      const heading = HEADING_RE.exec(line);
      if (heading) return { kind: "heading", text: heading[1] };
      const bullet = BULLET_RE.exec(line);
      if (bullet) return { kind: "bullet", text: bullet[1] };
      return { kind: "text", text: line };
    });
}

const NOTE_CLASS = {
  heading: "pt-1.5 font-semibold first:pt-0",
  bullet: "pl-3 text-muted-foreground before:mr-1.5 before:content-['•']",
  text: "text-muted-foreground",
} as const;

function formatMB(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Percentage and human-readable label for the download in flight; undefined
 *  until the release's size is known. */
function downloadProgress(downloaded: number, total?: number) {
  if (!total) return undefined;
  const pct = Math.min(100, Math.round(downloaded / total * 100));
  return { pct, label: `${formatMB(downloaded)} of ${formatMB(total)} · ${pct}%` };
}

function releaseUpdate(update: Update) {
  void update.close().catch((error) => {
    console.error(`Could not release the updater resource: ${String(error)}`);
  });
}

export function DesktopUpdater(props: { dirty: boolean; checkRequest: number; statusHost?: HTMLElement | null }) {
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
  useEffect(() => {
    if (!desktop || props.checkRequest === lastRequestRef.current) return;
    lastRequestRef.current = props.checkRequest;
    setOpen(true);
    if (updateRef.current) return;
    setStatus({ kind: "checking" });
    void performCheck().then((result) => present(result, true));
  }, [desktop, performCheck, present, props.checkRequest]);

  const dismiss = () => {
    if (status.kind === "downloading") return;
    setOpen(false);
    if (status.kind !== "available" && status.kind !== "current") setStatus({ kind: "idle" });
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
      // visible percent moves so the bar's width transition can play out.
      const pct = downloadProgress(downloaded, total)?.pct ?? -1;
      if (event.event === "Progress" && pct === shownPct) return;
      shownPct = pct;
      setStatus({ kind: "downloading", version: update.version, downloaded, total });
    };
    setStatus({ kind: "downloading", version: update.version, downloaded: 0 });
    try {
      await update.downloadAndInstall(showProgress, { timeout: 120_000 });
      await invoke("relaunch_app");
    } catch (error) {
      dropUpdate();
      setStatus({ kind: "error", message: `Could not install the update: ${String(error)}` });
    }
  };

  const download = status.kind === "downloading"
    ? downloadProgress(status.downloaded, status.total)
    : undefined;
  const releasedOn = status.kind === "available" && status.date
    ? ` · Released ${new Date(status.date).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      })}`
    : "";
  const busy = status.kind === "checking" || status.kind === "downloading";

  return (
    <>
      {desktop && props.statusHost && status.kind === "current" && createPortal(
        <span role="status" className="px-2 text-xs text-muted-foreground">Up to date</span>,
        props.statusHost,
      )}
      {desktop && props.statusHost && status.kind === "available" && createPortal(
        <span role="status">
          <Button variant="ghost" size="sm" className="h-6 gap-1.5 px-2 text-xs text-primary"
            onClick={() => setOpen(true)}>
            <Download data-icon="inline-start" aria-hidden="true" />
            Update available · {status.version}
          </Button>
        </span>, props.statusHost,
      )}
    <Dialog open={open}
      onOpenChange={(open) => { if (!open && !busy) dismiss(); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {status.kind === "available" && "Update available"}
            {status.kind === "downloading" && `Installing Label Lab ${status.version}`}
            {status.kind === "checking" && "Checking for updates"}
            {status.kind === "current" && "Label Lab is up to date"}
            {status.kind === "disabled" && "Updates are not configured"}
            {status.kind === "error" && "Update failed"}
          </DialogTitle>
          <DialogDescription>
            {status.kind === "available" && `Label Lab ${status.version}${releasedOn}`}
            {status.kind === "downloading" && "Keep Label Lab open while the update downloads."}
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
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-muted p-3 text-xs">
            {releaseNoteLines(status.body).map((line, i) => (
              <p key={i} className={NOTE_CLASS[line.kind]}>{line.text}</p>
            ))}
          </div>
        )}
        {status.kind === "available" && props.dirty && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            This label has unsaved changes. Choose Later and save it before restarting if you want
            to keep those changes.
          </p>
        )}
        {status.kind === "downloading" && (
          <div className="space-y-2" aria-live="polite">
            <Progress value={download?.pct ?? null} />
            <p className="text-xs text-muted-foreground">
              {download?.label ?? "Downloading…"}
            </p>
          </div>
        )}

        {status.kind === "available" && (
          <DialogFooter>
            <Button variant="outline" onClick={dismiss}>Later</Button>
            <Button onClick={() => void install()}>Install and Restart</Button>
          </DialogFooter>
        )}
        {(status.kind === "current" || status.kind === "disabled" || status.kind === "error") && (
          <DialogFooter>
            <Button onClick={dismiss}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
