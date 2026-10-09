// TabsShell.tsx — the workspace: a tab strip over one mounted DocumentEditor
// per open .label project, inactive ones hidden (display:none), their state
// intact but their rendered previews dropped (see App.tsx's active gating).
// The shell owns everything that outlives or spans documents: the tab list
// (src/tabs.ts), OS file-open and dropped-.label routing, the File → Open
// picker (an open must be able to target a new tab), the dirty-close confirm
// flow, shared render settings (persisted per operator — see settings.ts),
// the desktop updater, and window title/close integration.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { DocumentEditor, type DocumentMeta, type FileToOpen } from "@/App";
import { LABEL_FILTER, LABEL_TYPES, isAbort } from "@/filePickers";
import { openThrough } from "@/files";
import {
  activateTab, addTab, closeTab, initialTabs, routeFileOpen, unsaved, updateTabMeta,
  type TabsState,
} from "@/tabs";
import { LABEL_EXT } from "@/labelfile";
import { dropRecovery, earlierSnapshots, recoveryKey, type Recoverable } from "@/recovery";
import { loadRenderSettings, saveRenderSettings, type RenderSettings } from "@/settings";
import { DesktopUpdater } from "@/components/DesktopUpdater";
import { isFieldDrop } from "@/components/AssetDropOverlay";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** The one spelling of the window-module import its three consumers
 *  (destroy, close-requested, title) share. The registry caches the load. */
const currentWindow = () =>
  import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());

/** The shell-side per-tab objects that must stay identity-stable for the
 *  editor's memo bail to hold (see DocumentEditor): the save slot its
 *  editor assigns into, and the callbacks that close over the tab id. */
type TabExtras = {
  saveSlot: { current: (() => Promise<boolean>) | null };
  onMeta: (meta: DocumentMeta) => void;
  onCloseTab: () => void;
  onOpenSettled: (seq: number) => void;
};

export default function TabsShell() {
  const [state, setState] = useState(initialTabs);
  // The OS-open listener and window-close handler are registered once but
  // route against the current tabs; same pattern as App.tsx's commandsRef.
  // The ref, not `state`, is the authority: EVERY transition goes through
  // apply(), which advances it before React re-renders, so a second caller
  // in the same task (the OS drain loop) already sees the first one's
  // result instead of the pre-render state — two file-opens racing there
  // used to mint the same tab id and drop one of the files.
  const stateRef = useRef(state);
  /** Advance the tab state and return the new value. */
  const apply = useCallback((fn: (s: TabsState) => TabsState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);
  // Opens queued per tab. An entry lives from queueOpen until the editor
  // reports the open settled (onOpenSettled) or the tab closes; while it
  // lives it marks its tab as spoken-for so openRouted never "reuses" a tab
  // whose open is still in flight (see the pendingRef check there). It must
  // NOT outlive the attempt: routeFileOpen also dedupes by a queued entry's
  // path, so a stale entry made a FAILED open permanently un-retryable (the
  // re-open just focused the empty tab) and let a Save-As'd tab keep
  // claiming its original path. After success tab.filePath (path opens) or
  // the cleared dirty flag (every open) carries the claim; after failure
  // the tab is legitimately pristine again.
  const [pending, setPending] = useState<Record<number, FileToOpen>>({});
  // Mirror for the routing path: two opens can arrive in one task (the OS
  // drain loop), before the state above has flushed.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const seq = useRef(1);
  // Per-tab extras (save slot + id-closing callbacks), created once per tab
  // so inactive editors see identity-stable props and memo-bail. Dropped in
  // doClose. The callbacks reach the CURRENT handlers through `api` below —
  // a stable closure over a ref, the same pattern as stateRef.
  const extras = useRef(new Map<number, TabExtras>());
  const api = useRef<{ requestClose: (id: number) => void }>(null!);
  const extrasFor = (id: number): TabExtras => {
    let e = extras.current.get(id);
    if (!e) extras.current.set(id, (e = {
      saveSlot: { current: null },
      onMeta: (meta) => apply((s) => updateTabMeta(s, id, meta)),
      onCloseTab: () => api.current.requestClose(id),
      // The editor reports its open attempt finished (success or failure).
      // seq-guarded: a newer open queued to this tab owns the entry now.
      onOpenSettled: (settledSeq) => {
        if (pendingRef.current[id]?.seq !== settledSeq) return;
        const next = { ...pendingRef.current };
        delete next[id];
        pendingRef.current = next;
        setPending((p) => {
          if (p[id]?.seq !== settledSeq) return p;
          const n = { ...p };
          delete n[id];
          return n;
        });
      },
    }));
    return e;
  };
  // The dirty-close dialog: which tab it is deciding, and whether a Save
  // click is in flight (disables the buttons; a cancelled save dialog
  // resolves false and leaves this dialog up).
  const [confirmClose, setConfirmClose] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // A window close sweeps every unsaved tab through the same dialog; any
  // Cancel aborts the sweep and the close. A ref, not state: nothing
  // renders it — only doClose reads it.
  const closingWindow = useRef(false);
  const [checkRequest, setCheckRequest] = useState(0);
  // Set once an update is installed on disk: the app menu's Check for
  // Updates… becomes Restart to Update (same click, DesktopUpdater decides).
  const [updateInstalled, setUpdateInstalled] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // A File → Open picker failure (not a cancel): no tab exists yet to show
  // it, so the strip does. Cleared by the next successful pick.
  const [pickError, setPickError] = useState("");

  const anyUnsaved = state.tabs.some(unsaved);
  const activeTab = state.tabs.find((t) => t.id === state.active)!;

  // ---- shared, formerly per-document surfaces (moved from App.tsx) ----

  // One context-menu blocker for the whole window (right-click means "pan"
  // over the preview; nothing in this tool uses the browser menu).
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);

  // Render settings (Document Settings knobs): shared across tabs — they
  // describe the press's die and stock, not one label. Read from this
  // operator's saved settings at boot and written straight back on every
  // change: localStorage is synchronous and cheap, so there is no debounce
  // and nothing for the window-close paths to flush. Lifted here so
  // per-editor copies can't diverge and stomp the shared layout globals (see
  // App.tsx's RenderSettings note).
  const [render, setRender] = useState<RenderSettings>(loadRenderSettings);
  useEffect(() => { saveRenderSettings(render); }, [render]);

  // ---- crash recovery (#394) ----

  // Unsaved tabs an earlier launch left behind (a crash, a WebView kill, a
  // forced quit — a clean close drops them). Offered once at boot.
  const [recoverable, setRecoverable] = useState<Recoverable[]>([]);
  useEffect(() => { void earlierSnapshots().then(setRecoverable); }, []);
  const finishRecovery = (restore: boolean) => {
    for (const r of recoverable) {
      // Opened like a dropped .label (no save identity, so Save asks where);
      // the editor drops the old snapshot once the open succeeds.
      if (restore) openRouted({ file: new File([r.bytes as BlobPart], r.name), recovered: r.key });
      else void dropRecovery(r.key);
    }
    setRecoverable([]);
  };

  // ---- open routing ----

  /** Queue an open for tab `id`; the editor's fileToOpen effect runs it.
   *  pendingRef is written synchronously so a second open arriving in the
   *  same task already sees this tab as taken. */
  const queueOpen = (id: number, fo: Omit<FileToOpen, "seq">) => {
    const entry = { ...fo, seq: seq.current++ };
    pendingRef.current = { ...pendingRef.current, [id]: entry };
    setPending((p) => ({ ...p, [id]: entry }));
  };

  /** Both open entry points land here; tabs.ts's routeFileOpen is the one
   *  spelling of the rule (focus the tab already holding the path, reuse a
   *  pristine UNCLAIMED active tab, else a new tab — which addTab
   *  self-activates). The busy predicate is "has a queued open": see
   *  routeFileOpen's doc for why such tabs are never reused. */
  const openRouted = (fo: Omit<FileToOpen, "seq">) => {
    const s = stateRef.current;
    const route = routeFileOpen(
      s, fo.path,
      (id) => !!pendingRef.current[id],
      // Dedupe against queued-but-uncompleted opens too: tab.filePath stays
      // null until the async open finishes, and the OS re-delivers rapid
      // double-clicks (the Rust side queues them).
      (id) => pendingRef.current[id]?.path,
    );
    if ("focus" in route) { apply((st) => activateTab(st, route.focus)); return; }
    if ("reuse" in route) {
      queueOpen(route.reuse, fo);
      apply((st) => activateTab(st, route.reuse));
      return;
    }
    // addTab self-activates, so the new tab's id is the applied state's
    // `active` — never re-derived here.
    queueOpen(apply(addTab).active, fo);
  };

  /** OS file-opens (Finder / Explorer double-click, second-instance argv):
   *  the Rust side stores the path and emits (see take_opened_file in
   *  src-tauri/src/main.rs); pulled once the listener registers — a
   *  launch-by-file beats the webview loading — and again per emit. Routed
   *  by path identity: already open → focus, pristine active tab → reuse,
   *  else a new tab. */
  useEffect(() => {
    if (!isTauri()) return;
    async function openFromOs() {
      // Drain, don't take-once: the Rust side queues paths (rapid double-
      // clicks, multi-file opens) and one emit can cover several.
      for (;;) {
        const path = await invoke<string | null>("take_opened_file");
        if (!path) return;
        openRouted({ path });
      }
    }
    const stopping = import("@tauri-apps/api/event")
      .then(({ listen }) => listen("project-file-opened", () => void openFromOs()));
    // Drain only once the listener is live (#109): a drain before listen()
    // resolves leaves a gap where a delivery's emit reaches no one and the
    // path sits queued until the next open. The queue holds anything that
    // arrived earlier (a launch-by-file), so nothing is lost by waiting.
    void stopping.then(() => openFromOs());
    return () => void stopping.then((stop) => stop());
    // Routing reads live state through stateRef; the helpers are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Any OS file drag outside a file well is prevented here, or the webview
   *  navigates to the file and discards every tab (#121). Lives in the shell
   *  so the guard never depends on which editor is mounted. A dropped .label
   *  opens like the hidden-input fallback (bytes only; Save goes through
   *  Save As); textures and masks are routed by the active editor's
   *  AssetDropOverlay; anything else is ignored. */
  useEffect(() => {
    const guarded = (e: DragEvent) =>
      !!e.dataTransfer?.types.includes("Files") && !isFieldDrop(e.target);
    const onDragOver = (e: DragEvent) => { if (guarded(e)) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      if (!guarded(e)) return;
      e.preventDefault();
      const file = e.dataTransfer!.files[0];
      if (file?.name.toLowerCase().endsWith(LABEL_EXT)) openRouted({ file });
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
    // Routing reads live state through stateRef; the helpers are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** File → Open Project…: native dialog on desktop (a real path, routed
   *  exactly like an OS open, so the tab records filePath and ⌘S saves in
   *  place — WKWebView has no FS-Access picker), FS-Access picker in the
   *  browser (yields a writable handle, so Save rewrites the picked file),
   *  hidden-input fallback elsewhere. The editor runs the actual open (see
   *  fileToOpen in App.tsx). */
  async function openProjectPicker() {
    try {
      const target = await openThrough({ filter: LABEL_FILTER, types: LABEL_TYPES });
      if (target === undefined) { fileInput.current?.click(); return; }
      if (target === null) return;
      setPickError("");
      openRouted(target);
    } catch (err) {
      // Failures AFTER a tab is chosen surface in that editor's own alert;
      // this is the picker itself failing, before any tab exists — shown in
      // the strip, the shell's one visible surface.
      if (!isAbort(err))
        setPickError(`Could not open project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- closing ----

  const doClose = (id: number) => {
    void dropRecovery(recoveryKey(id)); // closed on purpose: nothing to recover
    extras.current.delete(id);
    delete pendingRef.current[id];
    setPending(({ [id]: _dropped, ...rest }) => rest);
    apply((s) => closeTab(s, id));
    setConfirmClose(null);
    // Mid-sweep: hand the dialog to the next unsaved tab, or finish the
    // window close. Computed against the post-close list.
    if (closingWindow.current) {
      const rest = stateRef.current.tabs.filter((t) => t.id !== id);
      const next = rest.find(unsaved);
      if (next) {
        apply((s) => activateTab(s, next.id));
        setConfirmClose(next.id);
      } else {
        void currentWindow().then((w) => void w.destroy());
      }
    }
  };

  /** Tab × / File → Close Tab: unsaved work gets the three-way dialog. */
  const requestClose = (id: number) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (unsaved(tab)) {
      apply((s) => activateTab(s, id)); // show what's being decided
      setConfirmClose(id);
    } else doClose(id);
  };
  api.current = { requestClose };

  const cancelClose = () => {
    setConfirmClose(null);
    closingWindow.current = false;
  };

  const saveAndClose = async (id: number) => {
    setSaving(true);
    try {
      // false = the user cancelled the save dialog — keep the tab (and,
      // mid-sweep, abort the window close: a cancel is a cancel).
      if (await extras.current.get(id)?.saveSlot.current?.()) doClose(id);
      else cancelClose();
    } finally {
      setSaving(false);
    }
  };

  // Identity-stable shared callbacks, for the editors' memo bail. apply is
  // stable; the picker reaches live state through stateRef.
  const newTab = useCallback(() => { apply(addTab); }, [apply]);
  const openProjectPickerRef = useRef(openProjectPicker);
  openProjectPickerRef.current = openProjectPicker;
  const openProject = useCallback(() => void openProjectPickerRef.current(), []);
  const checkForUpdates = useCallback(() => setCheckRequest((n) => n + 1), []);
  const activate = useCallback((id: number) => { apply((s) => activateTab(s, id)); }, [apply]);
  const closeReq = useCallback((id: number) => api.current.requestClose(id), []);

  // Desktop window close: intercept, sweep unsaved tabs through the dialog.
  useEffect(() => {
    if (!isTauri()) return;
    const stopping = currentWindow().then((w) =>
      w.onCloseRequested((event) => {
        const first = stateRef.current.tabs.find(unsaved);
        if (!first) return; // nothing unsaved — the close proceeds
        event.preventDefault();
        closingWindow.current = true;
        apply((s) => activateTab(s, first.id));
        setConfirmClose(first.id);
      }));
    return () => void stopping.then((stop) => stop());
  }, [apply]);

  // Browser window close: the generic prompt is all a page may show.
  useEffect(() => {
    if (isTauri() || !anyUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyUnsaved]);

  // Desktop app quit (#151): macOS Dock → Quit, logout and AppleScript
  // `quit` terminate the app without a window close, so the Rust side asks
  // this flag whether to cancel and route the quit through the close sweep
  // above, or let it through (see src-tauri/src/terminate.rs).
  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_unsaved", { unsaved: anyUnsaved });
  }, [anyUnsaved]);

  // Desktop window title tracks the active tab; • marks unsaved work.
  // Derived first so the effect deps on exactly the string it writes.
  const windowTitle = unsaved(activeTab) ? `• ${activeTab.title}` : activeTab.title;
  useEffect(() => {
    if (!isTauri()) return;
    void currentWindow().then((w) => w.setTitle(windowTitle));
  }, [windowTitle]);

  const confirmTab = state.tabs.find((t) => t.id === confirmClose) ?? null;

  // Portaled into the ACTIVE editor's slot just under its menubar row (see
  // tabStripHost in App.tsx): the fixed-position sidebar would overlap a
  // strip above the whole shell, and under the menubar is where tabs read
  // as document chrome. A portal, not a prop: the strip re-renders on every
  // tab retitle (each beer-name keystroke), and passing its element down
  // would defeat the active editor's memo on exactly that hot path.
  // Current VS Code tab language: each tab is a rounded chip floating in
  // the strip with a gap from its neighbors — contrast comes from fill, not
  // borders: the active chip in the editor background, a muted wash on
  // hover. The dirty dot lives in the close slot: a dot until hover, then
  // the ×. A saved tab's × shows on hover, and dimmed at rest on the active
  // tab (#424).
  // The active editor mounts the slot div and hands it up through this
  // stable ref callback; null while no editor is active (startup teardown).
  const [updateStatusHost, setUpdateStatusHost] = useState<HTMLDivElement | null>(null);
  const [stripHost, setStripHost] = useState<HTMLDivElement | null>(null);
  const tabStripHost = useCallback((el: HTMLDivElement | null) => setStripHost(el), []);
  // Switching or adding a tab re-hosts the strip in the new editor's slot,
  // and closing one removes the focused button; each drops focus to <body>.
  // After a KEYBOARD switch, + or close (Enter/Space: a click with detail 0)
  // focus goes to the tab at this index (#404): the one switched to, the new
  // one, or the one after a closed tab (the last tab when it was last), per
  // the WAI-ARIA tabs pattern. A mouse click lets go of focus so the arrows
  // go on nudging the canvas. It waits while the unsaved-close dialog holds
  // focus (its own focus return would land on a detached ×), and until the
  // tab is in the live document: mid-switch the strip is still in the old,
  // detached slot.
  const refocusTab = useRef<number | null>(null);
  useEffect(() => {
    const i = refocusTab.current;
    if (i === null || confirmClose !== null) return;
    const tabs = stripHost?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [];
    const tab = tabs[Math.min(i, tabs.length - 1)];
    if (!tab?.isConnected) return;
    refocusTab.current = null;
    tab.focus();
  }, [stripHost, state.tabs, state.active, confirmClose]);
  // useMemo so the strip element is rebuilt only when its content changes,
  // not on every unrelated shell state change.
  const tabStrip = useMemo(() => (
    <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-sidebar">
      {/* A tablist (#404) so assistive tech announces the active document;
          each chip's title button is the tab. Its close button stays a plain
          button inside the list: ARIA has no slot for a per-tab close, and
          hiding it would drop the unsaved-changes label (#403). The + and the
          pick error sit outside. No aria-controls: the editor isn't modelled
          as a panel. keys.ts gives a tablist the arrow keys, so Left/Right
          move focus between tabs here (Enter switches) instead of nudging. */}
      <div role="tablist" aria-label="Open documents" className="flex shrink-0 items-center gap-1.5"
        onKeyDown={(e) => {
          // Bare arrows only: ⌘/Ctrl/Alt/Shift+arrow keep their own meanings.
          const bare = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
          const step = !bare ? 0 : e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
          // From a tab or its × alike: both sit in that tab's chip.
          const i = tabs.findIndex((t) => t.parentElement?.contains(e.target as Node));
          if (!step || i < 0) return;
          e.preventDefault();
          tabs[(i + step + tabs.length) % tabs.length].focus();
        }}>
        {state.tabs.map((t, i) => (
          <div
            key={t.id}
            role="presentation"
            className={cn(
              "group flex h-6.5 min-w-0 max-w-48 shrink-0 items-center gap-1 rounded-md px-2.5",
              t.id === state.active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}>
            <button
              role="tab"
              aria-selected={t.id === state.active}
              onClick={(e) => {
                refocusTab.current = e.detail === 0 && t.id !== state.active ? i : null;
                // Chromium focuses a clicked button; on the active tab nothing
                // re-hosts, so that focus would keep the arrows from nudging.
                if (e.detail > 0) e.currentTarget.blur();
                activate(t.id);
              }}
              title={t.filePath ?? t.title}
              className="min-w-0 flex-1 truncate rounded-sm text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t.title}
            </button>
            <button
              onClick={(e) => {
                // An unsaved tab opens the close dialog first; the refocus
                // waits for it to close (Cancel keeps this tab at index i).
                refocusTab.current = e.detail === 0 ? i : null;
                closeReq(t.id);
              }}
              // The button's own label replaces its children's, so the unsaved
              // state has to be named here, not on the • inside it (#403).
              aria-label={`Close ${t.title}${unsaved(t) ? " (unsaved changes)" : ""}`}
              className={cn(
                // fraction-of-foreground, not bg-muted: it has to read on
                // both chip fills (active bg-background, hovered bg-muted)
                "rounded p-0.5 outline-none hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                // A saved tab's × waits for hover, except on the active tab,
                // where it rests dimmed: touch has no hover, and a fully
                // hidden × was never discovered (#424). An unsaved tab
                // always shows its •.
                !unsaved(t) && (t.id === state.active
                  ? "opacity-60 group-hover:opacity-100"
                  : "opacity-0 group-hover:opacity-100"),
              )}>
              {unsaved(t) ? (
                <>
                  <span className="block size-3 text-center leading-3 group-hover:hidden"
                    aria-hidden="true">•</span>
                  <X className="hidden size-3 group-hover:block" />
                </>
              ) : <X className="size-3" />}
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={(e) => {
          refocusTab.current = e.detail === 0 ? state.tabs.length : null;
          newTab();
        }}
        aria-label="New tab"
        title="New tab (⌘N)"
        className="shrink-0 rounded-md px-2 py-0.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        +
      </button>
      {pickError && (
        <span className="shrink-0 px-2 text-xs text-destructive-text">{pickError}</span>
      )}
    </div>
  ), [state.tabs, state.active, pickError, activate, closeReq, newTab]);

  return (
    <>
      {state.tabs.map((t) => {
        const e = extrasFor(t.id);
        const isActive = t.id === state.active;
        return (
            <div key={t.id} className={isActive ? "h-svh" : "hidden"}>
              {/* Every editor gets identity-stable props throughout (extras
                  + the useCallbacks + the strip-host ref), so the memo on
                  DocumentEditor bails and a keystroke in one tab never
                  re-runs the hidden ones — nor a second render of the
                  active one when its own keystroke retitles its tab. */}
              <DocumentEditor
                tabStripHost={tabStripHost}
                updateStatusHost={setUpdateStatusHost}
                active={isActive}
                fileToOpen={pending[t.id] ?? null}
                onOpenSettled={e.onOpenSettled}
                onMeta={e.onMeta}
                saveSlot={e.saveSlot}
                render={render}
                onRenderChange={setRender}
                onOpenProject={openProject}
                onNewTab={newTab}
                onCloseTab={e.onCloseTab}
                onCheckForUpdates={checkForUpdates}
                updateInstalled={updateInstalled}
                recoveryKey={recoveryKey(t.id)} />
            </div>
        );
      })}
      {/* The strip lands in the active editor's slot without being one of
          its props (see tabStripHost). */}
      {stripHost && createPortal(tabStrip, stripHost)}
      {/* Hidden-input Open fallback (browser without FS-Access): bytes, no
          save identity. Desktop never lands here — it uses the native dialog. */}
      <input ref={fileInput} type="file" accept={LABEL_EXT} className="hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) openRouted({ file: f });
        }} />
      {/* The dirty-close decision, per tab; Save resolves through the
          editor's own save flow (dialog cancel keeps the tab). */}
      <Dialog open={confirmTab !== null} onOpenChange={(open) => !open && cancelClose()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Close “{confirmTab?.title}”?</DialogTitle>
            <DialogDescription>
              This tab has unsaved changes. Save them, discard them, or keep
              the tab open.
              {/* Save writes only the .label (issue #159): name the master
                  edits it leaves behind rather than prompting a second
                  time. Inside the description so it is announced with it. */}
              {confirmTab?.masterUnsaved && (
                <>
                  {" "}This tab also has master changes. They'll be discarded
                  unless you Cancel and use File → Save Master.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={cancelClose}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={saving}
              onClick={() => confirmClose !== null && doClose(confirmClose)}>
              Discard
            </Button>
            <Button disabled={saving}
              onClick={() => confirmClose !== null && void saveAndClose(confirmClose)}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Escape / outside click only hides it: the snapshots stay for the next launch. */}
      <Dialog open={recoverable.length > 0} onOpenChange={(open) => !open && setRecoverable([])}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Recover unsaved work?</DialogTitle>
            <DialogDescription>
              Label Lab closed with unsaved changes in {recoverable.length === 1
                ? "1 tab" : `${recoverable.length} tabs`}: {recoverable.map((r) => r.name).join(", ")}.
              Restore opens each in a tab; save it to keep it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={() => finishRecovery(false)}>Discard</Button>
            <Button onClick={() => finishRecovery(true)}>Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DesktopUpdater dirty={anyUnsaved} checkRequest={checkRequest} statusHost={updateStatusHost}
        onInstalled={() => setUpdateInstalled(true)} />
    </>
  );
}
