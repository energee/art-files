// TabsShell.tsx — the workspace: a tab strip over one mounted DocumentEditor
// per open .label project, inactive ones hidden (display:none), their state
// intact but their rendered previews dropped (see App.tsx's active gating).
// The shell owns everything that outlives or spans documents: the tab list
// (src/tabs.ts), OS file-open routing, the File → Open picker (an open must
// be able to target a new tab), the dirty-close confirm flow, shared render
// settings (adopted from and persisted to the presets library), the desktop
// updater, window title/close integration, and the preview worker's
// disposal.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import {
  DocumentEditor, LABEL_TYPES, isAbort, openPicker,
  type DocumentMeta, type FileToOpen, type RenderSettings,
} from "@/App";
import {
  activateTab, addTab, closeTab, initialTabs, routeFileOpen, updateTabMeta,
} from "@/tabs";
import { LABEL_EXT } from "@/labelfile";
import { DEFAULT_RENDER, mutatePresets, usePresets } from "@/presets";
import { disposePreviewWorker } from "@/pdf/client";
import { DesktopUpdater } from "@/components/DesktopUpdater";
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
 *  editor assigns into, and the two callbacks that close over the tab id. */
type TabExtras = {
  saveSlot: { current: (() => Promise<boolean>) | null };
  onMeta: (meta: DocumentMeta) => void;
  onCloseTab: () => void;
};

export default function TabsShell() {
  const [state, setState] = useState(initialTabs);
  // The OS-open listener and window-close handler are registered once but
  // route against the current tabs; same pattern as App.tsx's commandsRef.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Opens queued per tab. Kept after handling — the editor's seq gate makes
  // a stale entry inert — and dropped with the tab.
  const [pending, setPending] = useState<Record<number, FileToOpen>>({});
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
      onMeta: (meta) => setState((s) => updateTabMeta(s, id, meta)),
      onCloseTab: () => api.current.requestClose(id),
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
  const fileInput = useRef<HTMLInputElement>(null);

  const unsaved = (t: { dirty: boolean; edited: boolean }) => t.dirty && t.edited;
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

  // The preview worker serves every tab; it dies with the workspace.
  useEffect(() => () => disposePreviewWorker(), []);

  // Render settings (Document Settings knobs): shared across tabs — they
  // describe the press's die and stock, not one label. Adopted from the
  // presets library once loaded, then debounced back into it. Lifted here
  // so per-editor copies can't diverge and stomp the shared layout globals
  // (see App.tsx's RenderSettings note).
  const { presets, loaded: presetsLoaded } = usePresets();
  const [render, setRender] = useState<RenderSettings>(DEFAULT_RENDER);
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !presetsLoaded) return;
    adopted.current = true;
    setRender(presets.render);
  }, [presetsLoaded, presets.render]);
  useEffect(() => {
    if (!adopted.current) return;
    const t = setTimeout(() => void mutatePresets((p) => ({ ...p, render })), 500);
    return () => clearTimeout(t);
  }, [render]);

  // ---- open routing ----

  /** Queue an open for tab `id`; the editor's fileToOpen effect runs it. */
  const queueOpen = (id: number, fo: Omit<FileToOpen, "seq">) =>
    setPending((p) => ({ ...p, [id]: { ...fo, seq: seq.current++ } }));

  /** Both open entry points land here; tabs.ts's routeFileOpen is the one
   *  spelling of the rule (focus the tab already holding the path, reuse a
   *  pristine active tab, else a new tab — which addTab self-activates). */
  const openRouted = (fo: Omit<FileToOpen, "seq">) => {
    const s = stateRef.current;
    const route = routeFileOpen(s, fo.path);
    if ("focus" in route) return setState((st) => activateTab(st, route.focus));
    if ("reuse" in route) {
      queueOpen(route.reuse, fo);
      return setState((st) => activateTab(st, route.reuse));
    }
    const next = addTab(s);
    setState(next);
    queueOpen(next.active, fo);
  };

  /** OS file-opens (Finder / Explorer double-click, second-instance argv):
   *  the Rust side stores the path and emits (see take_opened_file in
   *  src-tauri/src/main.rs); pulled once on mount — a launch-by-file beats
   *  the webview loading — and again per emit. Routed by path identity:
   *  already open → focus, pristine active tab → reuse, else a new tab. */
  useEffect(() => {
    if (!isTauri()) return;
    async function openFromOs() {
      const path = await invoke<string | null>("take_opened_file");
      if (path) openRouted({ path });
    }
    const stopping = import("@tauri-apps/api/event")
      .then(({ listen }) => listen("project-file-opened", () => void openFromOs()));
    void openFromOs();
    return () => void stopping.then((stop) => stop());
    // Routing reads live state through stateRef; the helpers are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** File → Open Project…: FS-Access picker where available (yields a
   *  writable handle, so Save rewrites the picked file), hidden-input
   *  fallback elsewhere. The editor runs the actual open (see fileToOpen
   *  in App.tsx). */
  async function openProjectPicker() {
    const pick = openPicker();
    if (!pick) { fileInput.current?.click(); return; }
    try {
      const [handle] = await pick({ types: LABEL_TYPES });
      openRouted({ handle });
    } catch (err) {
      if (!isAbort(err)) console.error(err); // open failures surface in-editor
    }
  }

  // ---- closing ----

  const doClose = (id: number) => {
    extras.current.delete(id);
    setPending(({ [id]: _dropped, ...rest }) => rest);
    setState((s) => closeTab(s, id));
    setConfirmClose(null);
    // Mid-sweep: hand the dialog to the next unsaved tab, or finish the
    // window close. Computed against the post-close list.
    if (closingWindow.current) {
      const rest = stateRef.current.tabs.filter((t) => t.id !== id);
      const next = rest.find(unsaved);
      if (next) {
        setState((s) => activateTab(s, next.id));
        setConfirmClose(next.id);
      } else {
        void currentWindow().then((w) => w.destroy());
      }
    }
  };

  /** Tab × / File → Close Tab: unsaved work gets the three-way dialog. */
  const requestClose = (id: number) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (unsaved(tab)) {
      setState((s) => activateTab(s, id)); // show what's being decided
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

  // Identity-stable shared callbacks, for the editors' memo bail. setState
  // is stable; the picker reaches live state through stateRef.
  const newTab = useCallback(() => setState(addTab), []);
  const openProjectPickerRef = useRef(openProjectPicker);
  openProjectPickerRef.current = openProjectPicker;
  const openProject = useCallback(() => void openProjectPickerRef.current(), []);
  const checkForUpdates = useCallback(() => setCheckRequest((n) => n + 1), []);

  // Desktop window close: intercept, sweep unsaved tabs through the dialog.
  useEffect(() => {
    if (!isTauri()) return;
    const stopping = currentWindow().then((w) =>
      w.onCloseRequested((event) => {
        const first = stateRef.current.tabs.find(unsaved);
        if (!first) return; // nothing unsaved — close proceeds
        event.preventDefault();
        closingWindow.current = true;
        setState((s) => activateTab(s, first.id));
        setConfirmClose(first.id);
      }));
    return () => void stopping.then((stop) => stop());
  }, []);

  // Browser window close: the generic prompt is all a page may show.
  useEffect(() => {
    if (isTauri() || !anyUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyUnsaved]);

  // Desktop window title tracks the active tab; • marks unsaved work.
  // Derived first so the effect deps on exactly the string it writes.
  const windowTitle = unsaved(activeTab) ? `• ${activeTab.title}` : activeTab.title;
  useEffect(() => {
    if (!isTauri()) return;
    void currentWindow().then((w) => w.setTitle(windowTitle));
  }, [windowTitle]);

  const confirmTab = state.tabs.find((t) => t.id === confirmClose) ?? null;

  // Rendered by the ACTIVE editor just under its menubar row (see the
  // tabStrip prop in App.tsx): the fixed-position sidebar would overlap a
  // strip above the whole shell, and under the menubar is where tabs read
  // as document chrome.
  // Current VS Code tab language: each tab is a rounded chip floating in
  // the strip with a gap from its neighbors — contrast comes from fill, not
  // borders: the active chip in the editor background, a muted wash on
  // hover. The dirty dot lives in the close slot: a dot until hover, then
  // the ×.
  const tabStrip = (
    <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-sidebar">
        {state.tabs.map((t) => (
          <div
            key={t.id}
            className={cn(
              "group flex h-6.5 min-w-0 max-w-48 shrink-0 items-center gap-1 rounded-md px-2.5",
              t.id === state.active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}>
            <button
              onClick={() => setState((s) => activateTab(s, t.id))}
              title={t.filePath ?? t.title}
              className="min-w-0 flex-1 truncate text-left text-xs outline-none">
              {t.title}
            </button>
            <button
              onClick={() => requestClose(t.id)}
              aria-label={`Close ${t.title}`}
              className={cn(
                // fraction-of-foreground, not bg-muted: it has to read on
                // both chip fills (active bg-background, hovered bg-muted)
                "rounded p-0.5 outline-none hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                !unsaved(t) && "opacity-0 group-hover:opacity-100",
              )}>
              {unsaved(t) ? (
                <>
                  <span className="block size-3 text-center leading-3 group-hover:hidden"
                    aria-label="unsaved changes">•</span>
                  <X className="hidden size-3 group-hover:block" />
                </>
              ) : <X className="size-3" />}
            </button>
          </div>
        ))}
        <button
          onClick={() => setState(addTab)}
          aria-label="New tab"
          title="New tab (⌘N)"
          className="shrink-0 rounded-md px-2 py-0.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          +
        </button>
    </div>
  );

  return (
    <>
      {state.tabs.map((t) => {
        const e = extrasFor(t.id);
        const isActive = t.id === state.active;
        return (
            <div key={t.id} className={isActive ? "h-svh" : "hidden"}>
              {/* Inactive editors get identity-stable props throughout
                  (extras + the useCallbacks + null strip), so the memo on
                  DocumentEditor bails and a keystroke in one tab never
                  re-runs the hidden ones. */}
              <DocumentEditor
                tabStrip={isActive ? tabStrip : null}
                active={isActive}
                fileToOpen={pending[t.id] ?? null}
                onMeta={e.onMeta}
                saveSlot={e.saveSlot}
                render={render}
                onRenderChange={setRender}
                onOpenProject={openProject}
                onNewTab={newTab}
                onCloseTab={e.onCloseTab}
                onCheckForUpdates={checkForUpdates} />
            </div>
        );
      })}
      {/* Hidden-input Open fallback (no FS-Access): bytes, no save identity. */}
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
      <DesktopUpdater dirty={anyUnsaved} checkRequest={checkRequest} />
    </>
  );
}
