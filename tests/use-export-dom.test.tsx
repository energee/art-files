// @vitest-environment happy-dom
// use-export-dom.test.tsx — what useExport reports for the combined print PDF
// and the explicitly requested legacy PDF pair, as toasts, against a faked
// save dialog: a fresh export confirms with Show in Finder on desktop, a
// cancel says nothing (unless a pair is left half saved, which warns and offers
// Export again), a failed write stays as an error naming the file, an edit
// during the export withholds the confirmation (#400), and a later export
// replaces only its own earlier toast (#473). The real <Toaster /> shows them
// (tests/toast-harness.ts).
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { TOAST_MS, notify } from "../src/notify";
import { advance, mount, setupToastHarness, settleDismissal, show, text, toastCount } from "./toast-harness";

type Saved = { name: string; bytes: Uint8Array; target?: { path: string } } | null;
const save = vi.hoisted(() => ({
  next: [] as (() => Promise<Saved>)[],
  requests: [] as { name: string; target?: unknown }[],
  desktop: false,
  revealItemInDir: vi.fn(async (_path: string) => undefined),
}));
vi.mock("../src/files", () => ({
  saveThrough: (bytes: Uint8Array, options: { name: string; target?: unknown }) => {
    save.requests.push({ name: options.name, target: options.target });
    return save.next.shift()?.() ?? Promise.resolve({ name: options.name, bytes });
  },
  nativeExists: async () => false,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => save.desktop }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: save.revealItemInDir }));
// The real builders run (as save-races-dom does) on the fixture fonts; only
// the save dialog is faked. An empty layer list still yields both plates.
vi.mock("../src/fonts", () => ({ FONT_URLS: { poppins: {} } }));
vi.mock("../src/pdf/fonts", async () => {
  const { assets } = await import("./fixtures");
  return { loadFonts: async () => assets.fonts };
});

await import("../src/pdf/build"); // before any test fakes the clock (tests/toast-harness.ts)
const { useExport } = await import("../src/useExport");

setupToastHarness();

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

let api: ReturnType<typeof useExport>;
let failBuild = false;
/** The `tag` of the Probe render each build read its art from: which render's
 *  state the build saw. */
let builds: string[] = [];

/** Stands for App's "Export … As…" pair command, which Export again runs: the
 *  editor's latest render exporting the pair, asking. */
const again = vi.fn((format: "pdf" | "psd") => {
  void (format === "pdf" ? api.buildFull({ ask: true }, "pair") : api.exportPsd({ ask: true }, "pair"));
});

/** One editor; render it again with another `tag` to stand for an edit. */
function Probe({ tag = "before" }: { tag?: string }) {
  api = useExport({
    drawLayers: [], family: "poppins", liveImages: {}, planAssets: () => ({}) as never,
    pageArt: () => { builds.push(tag); if (failBuild) throw new Error("No art"); return {}; },
    title: "T", exportBase: "Lupula", render: DEFAULT_RENDER, exportAgain: again,
  });
  return null;
}

beforeEach(() => {
  save.next = [];
  save.requests = [];
  save.desktop = false;
  save.revealItemInDir.mockClear();
  failBuild = false;
  builds = [];
  again.mockClear();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC);
});
afterEach(() => { vi.restoreAllMocks(); });

const names = () => save.requests.map((request) => request.name);
const toastType = () => document.querySelector("[data-sonner-toast]")?.getAttribute("data-type");
const toastTitle = () => document.querySelector("[data-title]")?.textContent;
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

/** Run an export to the end, then let Sonner's deferred render of its toast land. */
async function finish(run: () => Promise<void>) {
  await act(async () => { await run(); });
  advance(0);
}

const printPdf = () => finish(() => api.buildFull());
const pdfPair = () => finish(() => api.buildFull({}, "pair"));

/** Resolve once the save dialog has been asked for `count` files in all. A real
 *  macrotask wait: unlike vi.waitFor it never moves the faked clock. */
async function untilRequests(count: number) {
  while (save.requests.length < count) await new Promise((resolve) => setImmediate(resolve));
}

/** Click the warning's Export again and let the pair it re-runs finish. */
async function rerun() {
  const before = save.requests.length;
  await finish(async () => {
    button("Export again")!.click();
    await vi.waitFor(() => expect(save.requests.length).toBeGreaterThanOrEqual(before + 2));
  });
}

it("a fresh export toasts Saved Lupula.pdf, which fades, with no action in the browser", async () => {
  mount(<Probe />);
  await printPdf();
  expect(names()).toEqual(["Lupula.pdf"]);
  expect(text()).toContain("Saved Lupula.pdf");
  expect(toastType()).toBe("success");
  expect(button("Show in Finder")).toBeUndefined();

  advance(TOAST_MS.success);
  settleDismissal();
  expect(toastCount()).toBe(0);
}, 30000);

// On desktop a save is named by its path: the toast names the file, and Show
// in Finder gets the whole path.
it.each([
  ["/Users/x/Lupula.pdf"],
  ["C:\\Users\\x\\Lupula.pdf"],
])("a fresh export toasts Saved Lupula.pdf with Show in Finder on desktop (%s)", async (path) => {
  save.desktop = true;
  save.next = [async () => ({ name: path, bytes: new Uint8Array(), target: { path } })];
  mount(<Probe />);
  await printPdf();
  expect(toastTitle()).toBe("Saved Lupula.pdf");

  await act(async () => { button("Show in Finder")!.click(); });
  expect(save.revealItemInDir).toHaveBeenCalledWith(path);
}, 30000);

it("a pair's toast names both files and reveals the first", async () => {
  // The mask goes beside the art file, named by its path too.
  save.desktop = true;
  save.next = [async () => ({ name: "/Users/x/Lupula.pdf", bytes: new Uint8Array(), target: { path: "/Users/x/Lupula.pdf" } })];
  mount(<Probe />);
  await pdfPair();
  expect(toastTitle()).toBe("Saved Lupula.pdf, Lupula-mask.pdf");

  await act(async () => { button("Show in Finder")!.click(); });
  expect(save.revealItemInDir).toHaveBeenCalledWith("/Users/x/Lupula.pdf");
}, 30000);

it("a cancelled one-file export shows no toast", async () => {
  save.next = [async () => null];
  mount(<Probe />);
  await printPdf();
  advance(60_000);
  expect(names()).toEqual(["Lupula.pdf"]);
  expect(toastCount()).toBe(0);
}, 30000);

it("a pair cancelled at the art file shows no toast", async () => {
  save.next = [async () => null];
  mount(<Probe />);
  await pdfPair();
  advance(60_000);
  expect(names()).toEqual(["Lupula.pdf"]);
  expect(toastCount()).toBe(0);
}, 30000);

it("a pair cancelled at the mask warns, and Export again re-runs it asking", async () => {
  mount(<Probe />);
  save.next = [async () => ({ name: "Lupula.pdf", bytes: new Uint8Array() }), async () => null];
  await pdfPair();
  expect(toastTitle()).toBe("Lupula-mask.pdf wasn't saved");
  expect(text()).toContain("Export again to save both files.");
  expect(toastType()).toBe("warning");

  // The warning stays until it is closed or acted on.
  advance(60_000);
  expect(toastTitle()).toBe("Lupula-mask.pdf wasn't saved");

  await rerun();
  expect(again).toHaveBeenCalledExactlyOnceWith("pdf");
  expect(names()).toEqual(["Lupula.pdf", "Lupula-mask.pdf", "Lupula.pdf", "Lupula-mask.pdf"]);
}, 30000);

// On desktop a saved art file's path is remembered, so a plain repeat export
// would rewrite it with no dialog (a target); Export again asks (none).
it("Export again asks even when the art file's path is remembered", async () => {
  save.next = [
    async () => ({ name: "/out/Lupula.pdf", bytes: new Uint8Array(), target: { path: "/out/Lupula.pdf" } }),
    async () => null,
  ];
  mount(<Probe />);
  await pdfPair();
  expect(toastTitle()).toBe("Lupula-mask.pdf wasn't saved");
  expect(save.requests[0].target).toBeUndefined();

  await rerun();
  expect(save.requests[2]).toEqual({ name: "/out/Lupula.pdf", target: undefined });
  // A plain repeat export, by contrast, writes the remembered path with no dialog.
  await pdfPair();
  expect(save.requests[4].target).toEqual({ path: "/out/Lupula.pdf" });
}, 30000);

// The warning outlives the render that made it. Export again hands the format to
// the editor (App runs its own Export … As… command); this stands in for that
// with the latest render's export, which App's live command table also is.
it("Export again exports the label as it is when clicked, not as the cancelled export saw it", async () => {
  save.next = [
    async () => ({ name: "/out/Lupula.pdf", bytes: new Uint8Array(), target: { path: "/out/Lupula.pdf" } }),
    async () => null,
  ];
  mount(<Probe tag="before" />);
  await pdfPair();
  expect(builds).toEqual(["before"]);

  mount(<Probe tag="after" />); // the label was edited
  await rerun();
  expect(builds).toEqual(["before", "after"]);
  expect(save.requests[2]).toEqual({ name: "/out/Lupula.pdf", target: undefined }); // and it asked
}, 30000);

it("a failed write keeps an error toast naming the file", async () => {
  save.next = [async () => { throw new Error("disk full"); }];
  mount(<Probe />);
  await printPdf();
  expect(toastTitle()).toBe("Couldn't save Lupula.pdf");
  expect(text()).toContain("disk full");
  expect(toastType()).toBe("error");

  advance(60_000);
  expect(toastTitle()).toBe("Couldn't save Lupula.pdf");
  expect(document.querySelectorAll("[data-close-button]")).toHaveLength(1);
}, 30000);

it("a failed write names the file, not its folder, when the label has a path", async () => {
  save.next = [async () => { throw new Error("disk full"); }];
  mount(<Probe />);
  await finish(() => api.buildFull({ labelPath: "/Users/x/Lupula.label" }));
  expect(toastTitle()).toBe("Couldn't save Lupula.pdf");
}, 30000);

it("reports the first file saved and the second that failed", async () => {
  save.next = [async () => ({ name: "Lupula.pdf", bytes: new Uint8Array() }), async () => { throw new Error("disk full"); }];
  mount(<Probe />);
  await pdfPair();
  expect(toastTitle()).toBe("Couldn't save Lupula-mask.pdf");
  expect(text()).toContain("Saved Lupula.pdf. disk full");
  expect(text()).not.toContain("wasn't saved");
}, 30000);

it("a failure before the first file is saved names the file the dialog would suggest", async () => {
  failBuild = true;
  mount(<Probe />);
  await pdfPair();
  expect(text()).toContain("Couldn't save Lupula.pdf");
  expect(text()).toContain("No art");
  expect(names()).toEqual([]);
}, 30000);

// A run starts by dismissing its own toast (and nothing else does), so a
// failure stays until the next export replaces it.
it("the next export replaces the earlier toast, and leaves another source's alone (#473)", async () => {
  let release!: () => void;
  save.next = [
    async () => { throw new Error("disk full"); },
    () => new Promise<Saved>((resolve) => { release = () => resolve({ name: "Lupula.pdf", bytes: new Uint8Array() }); }),
  ];
  mount(<Probe />);
  show(() => notify.error("Could not load image: bad.png", { id: "image" }));
  await printPdf();
  expect(text()).toContain("Couldn't save Lupula.pdf");
  expect(toastCount()).toBe(2);

  // The second export's dialog stays open while the failure's toast exits.
  let running!: Promise<void>;
  await act(async () => {
    running = api.buildFull();
    await vi.waitFor(() => expect(save.requests).toHaveLength(2));
  });
  settleDismissal();
  expect(text()).not.toContain("Couldn't save Lupula.pdf");
  await finish(async () => { release(); await running; });
  expect(text()).toContain("Saved Lupula.pdf");
  expect(text()).not.toContain("Couldn't save Lupula.pdf");
  expect(text()).not.toContain("disk full");
  expect(text()).toContain("Could not load image: bad.png");
  expect(toastCount()).toBe(2);
}, 30000);

it.each([
  ["one-file", () => api.buildFull()],
  ["pair", () => api.buildFull({}, "pair")],
])("an edit during the %s export withholds the success toast (#400)", async (_kind, start) => {
  let release!: () => void;
  save.next = [() => new Promise<Saved>((resolve) => {
    release = () => resolve({ name: "Lupula.pdf", bytes: new Uint8Array() });
  })];
  mount(<Probe />);
  let running!: Promise<void>;
  await act(async () => {
    running = start();
    await vi.waitFor(() => expect(save.requests).toHaveLength(1));
  });
  act(() => api.exportStale());
  await finish(async () => { release(); await running; });

  // Looked at right away: a success toast would fade by itself after TOAST_MS.success.
  expect(toastCount()).toBe(0);
}, 30000);

// Sonner keeps a dismissed id ~250 ms and folds a toast shown under it into the
// dying one (src/useOwnedToast.ts), so runs that shared one id would lose this
// error, which is shown just after the previous run's toast starts to exit.
it("a repeat export that fails soon after dismissing the last toast still shows its error, and keeps it", async () => {
  let fail!: () => void;
  save.next = [
    async () => ({ name: "Lupula.pdf", bytes: new Uint8Array() }),
    () => new Promise<Saved>((_, reject) => { fail = () => reject(new Error("disk full")); }),
  ];
  mount(<Probe />);
  await printPdf();
  expect(toastTitle()).toBe("Saved Lupula.pdf");

  let running!: Promise<void>;
  await act(async () => { running = api.buildFull(); await untilRequests(2); });
  advance(50); // the first toast's dismissal reaches Sonner, which starts its exit
  await finish(async () => { fail(); await running; });
  settleDismissal();

  expect(toastTitle()).toBe("Couldn't save Lupula.pdf");
  expect(toastCount()).toBe(1);
  advance(60_000);
  expect(toastTitle()).toBe("Couldn't save Lupula.pdf");
}, 30000);

it("closing the tab dismisses its export toast", async () => {
  save.next = [async () => ({ name: "Lupula.pdf", bytes: new Uint8Array() }), async () => null];
  mount(<Probe />);
  await pdfPair();
  expect(button("Export again")).toBeDefined();

  mount(); // the editor unmounts: its tab was closed
  settleDismissal();
  expect(toastCount()).toBe(0);
}, 30000);

it("a warning that lands after its tab closed offers no Export again", async () => {
  let cancel!: () => void;
  save.next = [
    async () => ({ name: "Lupula.pdf", bytes: new Uint8Array() }),
    () => new Promise<Saved>((resolve) => { cancel = () => resolve(null); }),
  ];
  mount(<Probe />);
  let running!: Promise<void>;
  await act(async () => { running = api.buildFull({}, "pair"); await untilRequests(2); });
  mount(); // closed while the second dialog is open
  await finish(async () => { cancel(); await running; });

  expect(toastTitle()).toBe("Lupula-mask.pdf wasn't saved");
  expect(button("Export again")).toBeUndefined();
}, 30000);
