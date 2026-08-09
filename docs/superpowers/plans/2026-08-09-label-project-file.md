# `.label` Project File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save/load a single `.label` file (a ZIP) that bundles the label's `ConfigFile` JSON plus the original source images, so a beer's label can be reopened for editing later.

**Architecture:** A pure pack/unpack module (`src/labelfile.ts`, fflate) with role-named ZIP entries (`texture/<name>`, `mask/<name>`, `collab-left/<name>`, `collab-center/<name>`, `config.json`); App.tsx wires it to a File-menu "Save Project…" (download) and "Open Project…" (hidden file input) by reusing the existing `parseConfigFile` normalize path and the existing `onTexture`/`onMask`/`onCollab` handlers fed with reconstructed `File` objects.

**Tech Stack:** TypeScript, React 19, Vite, vitest, fflate (new dependency).

## Global Constraints

- Worktree: `/Users/tedslesinski/Repos/art-files/.agents/worktrees/project-file`, branch `project-file`. Verify with `pwd` and `git branch --show-current` before any change.
- Spec: `docs/superpowers/specs/2026-08-09-label-project-file-design.md`.
- Images are stored in the ZIP **uncompressed** (`level: 0`) — PNGs are already deflated; `config.json` uses default deflate.
- Suffix is `.label`; saved file is named `<exportBaseName(cfg)>.label` (see `src/defaults.ts:25`).
- Validation: `npx tsc --noEmit` and `npm test` (vitest) must be clean before each commit.
- No Co-Authored-By lines in commits.
- Deliberate deviation from spec (approved direction, noted for the user): loading is via File menu → "Open Project…" only; drag-drop of `.label` is skipped because `.label` has no MIME type during `dragenter`, so `AssetDropOverlay`'s arming logic can't see it. Add later if wanted.

---

### Task 1: `src/labelfile.ts` — pure pack/unpack

**Files:**
- Modify: `package.json` (add dependency `fflate@^0.8.2`)
- Create: `src/labelfile.ts`
- Test: `tests/labelfile.test.ts`

**Interfaces:**
- Consumes: `LabelConfig`, `ConfigFile` types from `@/types`; `toConfigFile` from `@/defaults`.
- Produces (Task 2 relies on these exact signatures):
  - `type LabelAsset = { name: string; bytes: Uint8Array }`
  - `type LabelAssets = { texture?: LabelAsset; mask?: LabelAsset; collabLeft?: LabelAsset; collabCenter?: LabelAsset }`
  - `function packLabel(config: LabelConfig, assets: LabelAssets): Uint8Array`
  - `function unpackLabel(bytes: Uint8Array): { json: string; assets: LabelAssets }` — throws `Error("Not a .label file: missing config.json")` when `config.json` is absent.

- [ ] **Step 1: Install fflate**

```bash
npm install fflate
```

- [ ] **Step 2: Write the failing test**

`tests/labelfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { packLabel, unpackLabel } from "@/labelfile";
import { defaultConfig, parseConfigFile } from "@/defaults";
import { zipSync, strToU8 } from "fflate";

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("labelfile", () => {
  it("round-trips config and assets", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Test IPA";
    const zip = packLabel(cfg, {
      texture: { name: "rock.png", bytes: png() },
      mask: { name: "metal mask.png", bytes: png() },
      collabLeft: { name: "friend.svg", bytes: strToU8("<svg/>") },
    });
    const out = unpackLabel(zip);
    expect(parseConfigFile(out.json).beerName).toBe("Test IPA");
    expect(out.assets.texture).toEqual({ name: "rock.png", bytes: png() });
    expect(out.assets.mask?.name).toBe("metal mask.png");
    expect(out.assets.collabLeft?.name).toBe("friend.svg");
    expect(out.assets.collabCenter).toBeUndefined();
  });

  it("packs with no assets", () => {
    const out = unpackLabel(packLabel(defaultConfig(), {}));
    expect(parseConfigFile(out.json)).toBeTruthy();
    expect(out.assets).toEqual({});
  });

  it("rejects a zip without config.json", () => {
    const zip = zipSync({ "readme.txt": strToU8("hi") });
    expect(() => unpackLabel(zip)).toThrow(/missing config\.json/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/labelfile.test.ts`
Expected: FAIL — cannot resolve `@/labelfile`.

- [ ] **Step 4: Write the implementation**

`src/labelfile.ts`:

```ts
// labelfile.ts — pack/unpack the .label project file: a ZIP holding
// config.json (the ConfigFile JSON) plus the original source images under
// role directories (texture/<name>, mask/<name>, collab-left/<name>,
// collab-center/<name>). Images are stored uncompressed (level 0): PNG/JPG
// bytes are already compressed, and storing them untouched keeps the file
// lossless and byte-identical on round-trip.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { LabelConfig } from "@/types";
import { toConfigFile } from "@/defaults";

export type LabelAsset = { name: string; bytes: Uint8Array };
export type LabelAssets = {
  texture?: LabelAsset;
  mask?: LabelAsset;
  collabLeft?: LabelAsset;
  collabCenter?: LabelAsset;
};

/** ZIP directory name for each asset role. The original filename lives as
 *  the entry's basename, so a re-save round-trips it for free. */
const ROLE_DIRS: Record<keyof LabelAssets, string> = {
  texture: "texture",
  mask: "mask",
  collabLeft: "collab-left",
  collabCenter: "collab-center",
};

export function packLabel(config: LabelConfig, assets: LabelAssets): Uint8Array {
  const zip: Zippable = {
    "config.json": strToU8(JSON.stringify(toConfigFile(config), null, 2)),
  };
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [keyof LabelAssets, string][]) {
    const a = assets[role];
    if (a) zip[`${dir}/${a.name}`] = [a.bytes, { level: 0 }];
  }
  return zipSync(zip);
}

/** Unpack a .label ZIP. Returns the raw config JSON (callers run it through
 *  parseConfigFile, which owns validation and migration) and whichever
 *  assets the file holds. Throws a readable error when config.json is
 *  absent — the one thing that makes bytes not a .label file. */
export function unpackLabel(bytes: Uint8Array): { json: string; assets: LabelAssets } {
  const entries = unzipSync(bytes);
  const config = entries["config.json"];
  if (!config) throw new Error("Not a .label file: missing config.json");
  const assets: LabelAssets = {};
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [keyof LabelAssets, string][]) {
    const path = Object.keys(entries).find((p) => p.startsWith(`${dir}/`));
    if (path) assets[role] = { name: path.slice(dir.length + 1), bytes: entries[path] };
  }
  return { json: strFromU8(config), assets };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/labelfile.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Typecheck, full suite, commit**

```bash
npx tsc --noEmit && npm test
git add package.json package-lock.json src/labelfile.ts tests/labelfile.test.ts
git commit -m "Add labelfile pack/unpack for the .label project format"
```

---

### Task 2: App wiring — Save Project… / Open Project…

**Files:**
- Modify: `src/App.tsx`
- Test: manual (this task is UI/state glue; the format logic is covered by Task 1's tests, and App.tsx has no existing test harness)

**Interfaces:**
- Consumes from Task 1: `packLabel`, `unpackLabel`, `LabelAssets`.
- Consumes existing: `parseConfigFile`, `exportBaseName` (`@/defaults`); `setCfg` (`src/App.tsx:236`); `onTexture` (~line 627), `onMask` (~line 643), `onCollab` (~line 665); `clearLoaded` (~line 677); `download(url, name)` helper (~line 226); `startSaveBatch`/save-URL bookkeeping (~line 829, mirror how `downloadPresets` at ~line 926 triggers a download); `Loaded` type (~line 67); `CollabFile` type (~line 71).

- [ ] **Step 1: Keep original mask bytes for save**

`onMask` stores *processed* bytes (recolored via `prepareMaskForPdf`), so saving those would double-process on reload. Add the original file bytes to the mask state:

- Extend the mask state type where it is declared (near line 276) to include `srcBytes: Uint8Array`.
- In `onMask`, before decoding: `const srcBytes = new Uint8Array(await f.arrayBuffer());` and include `srcBytes` in the object passed to `setMask`.
- Texture needs nothing: its `bytes` field already holds the original file bytes.
- Collab needs nothing: `CollabFile.image` holds original raster bytes or SVG source text.
- Update the comment on the mask state/`Loaded` type to note which bytes are original vs processed.

- [ ] **Step 2: Add the save handler**

Next to the other export handlers (near `downloadArt`, ~line 868):

```tsx
/** File → Save Project…: everything needed to reopen this label — config
 *  plus original image bytes — zipped as <beerName>.label (see labelfile.ts). */
function saveProject() {
  const enc = (s: string) => new TextEncoder().encode(s);
  const collabAsset = (c: CollabFile | null) =>
    c ? { name: c.name, bytes: c.image.kind === "svg" ? enc(c.image.svg) : c.image.bytes } : undefined;
  const zip = packLabel(cfg, {
    texture: texture ? { name: texture.name, bytes: texture.bytes } : undefined,
    mask: mask ? { name: mask.name, bytes: mask.srcBytes } : undefined,
    collabLeft: collabAsset(collabLeft),
    collabCenter: collabAsset(collabCenter),
  });
  startSaveBatch();
  saveUrl(
    URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: "application/zip" })),
    `${exportBaseName(cfg)}.label`,
  );
}
```

(`saveUrl` here means the existing tracked-URL download helper at ~line 833; if it has a different name, use that name — the pattern to copy is `downloadPresets`.)

- [ ] **Step 3: Add the open handler**

```tsx
/** File → Open Project…: unzip a .label, run its config through the same
 *  forgiving parseConfigFile path saved configs use, then feed each embedded
 *  image through the exact handler a manual drop uses so previews, mask
 *  polarity, and object-URL lifecycle behave identically. Slots absent from
 *  the file are cleared: opening a project is a full restore, not a merge. */
async function openProject(f: File) {
  let unpacked: ReturnType<typeof unpackLabel>;
  let config: LabelConfig;
  try {
    unpacked = unpackLabel(new Uint8Array(await f.arrayBuffer()));
    config = parseConfigFile(unpacked.json);
  } catch (err) {
    window.alert(`Could not open ${f.name}: ${err instanceof Error ? err.message : err}`);
    return;
  }
  setCfg(() => config);
  clearLoaded(setTexture);
  clearLoaded(setMask);
  clearLoaded(setCollabLeft);
  clearLoaded(setCollabCenter);
  const toFile = (a: { name: string; bytes: Uint8Array }) =>
    new File([a.bytes as unknown as BlobPart], a.name);
  const { texture: t, mask: m, collabLeft: l, collabCenter: c } = unpacked.assets;
  if (t) void onTexture(toFile(t));
  if (m) void onMask(toFile(m));
  if (l) onCollab("left", toFile(l));
  if (c) onCollab("center", toFile(c));
}
```

Before using `window.alert`, check whether the app already has an error surface (`grep -n "alert\|toast\|warning" src/App.tsx src/warning.ts`); if it does, use that instead.

- [ ] **Step 4: Add a hidden file input and menu/command entries**

- `const openRef = useRef<HTMLInputElement>(null);` near the other refs.
- In the returned JSX: `<input ref={openRef} type="file" accept=".label" className="hidden" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void openProject(f); }} />`.
- Add to the commands table (~line 967): `{ id: "project-open", label: "Open Project…", run: () => openRef.current?.click() }` and `{ id: "project-save", label: "Save Project…", run: saveProject }` — this also puts both in the ⌘K command menu for free.
- Add both to the File menu (`MenubarContent`, ~line 1042) as `MenubarItem`s above the export items, followed by a `MenubarSeparator`, mirroring the existing `byId(...)` pattern.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npm test
```

Then manual smoke test in `npm run dev`: load texture + mask + a collab SVG, set a beer name, File → Save Project…, reload the page, File → Open Project…, confirm name/styles/images/preview all restore and mask polarity is unchanged. Per repo rules, never claim this passed without actually doing it.

- [ ] **Step 6: Update docs and commit**

- Check `README.md` for a File-menu or workflow section (`grep -n "menu\|Export\|preset" README.md`); if it documents user-facing actions, add Save/Open Project there.
- App.tsx's header comment (line 1) lists what state it owns — extend it to mention project save/open if the wording now misleads.

```bash
git add src/App.tsx README.md
git commit -m "Wire .label save/open into the File menu"
```

---

## Self-review notes

- Spec coverage: format (Task 1), save (Task 2 step 2), load (Task 2 steps 3-4), errors/versioning (`unpackLabel` throw + `parseConfigFile`), lossless storage (`level: 0`). Drag-drop loading is consciously deferred (see Global Constraints) — flag to the user at handoff.
- Types consistent: `LabelAsset`/`LabelAssets`/`packLabel`/`unpackLabel` used identically in both tasks; `mask.srcBytes` introduced in Task 2 step 1 and consumed in step 2.
- Line numbers are anchors from commit a317a0a, not gospel — search for the named symbols if they've drifted.
