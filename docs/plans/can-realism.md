# A more realistic 3D can preview

Status: planned (order 2 of 3: white-ink PDF → realistic can → CMYK export).
Open question for the user before task 2: which part reads as fake.

## Why

The 3D view (`src/three/canScene.ts`, `public/Can.gltf`, `public/studio.hdr`)
is how a label gets judged before print. If it looks off, approvals rest on a
render nobody trusts.

## What already exists (don't redo it)

- Real can model (`Can.gltf`: body, shell, chamfer, indent, cut meshes) with
  `MeshPhysicalMaterial`, clearcoat 1 / roughness 0.1.
- Label = open `CylinderGeometry` at `1.005 ×` can radius, `MeshStandardMaterial`
  with per-pixel metalness / roughness (matte 0.8 ↔ foil 0.33) and bump, all
  derived from the white-ink plate (`metalnessMask.ts`, `labelTextures.ts`).
- `studio.hdr` as environment only, ACES filmic at exposure 0.55, key/fill/rim
  directional lights, a fake shadow plane, max texture anisotropy, DPR 2–3.

So realism comes from targeted fixes, picked by looking at the render. Don't
swap in a new rendering approach.

## Tasks

Visual work: per `~/.claude/CLAUDE.md`, TDD only the logic and verify the
render by eye. Invoke the `measure-first` skill before any tuning edit. Every
change ships with before/after screenshots at the same camera, from the same
label. Worktree `.agents/worktrees/can-realism/`, branch `feat/can-realism`.

### 1. Baseline + reference (no code)
- Screenshot can, pack and flat views for 2–3 real labels at the default
  camera (the `run` skill launches the app).
- The user supplies photos of the same printed labels on cans: one studio
  shot, one under daylight.
- Put the screenshots and photos side by side in an artifact. List the gaps
  you can see, ranked by how much each one fools the eye.

### 2. User picks the top gaps — gate
Only the gaps the user picks go forward. The likely candidates below are
ordered cheap → expensive. Each is independent and reverts on its own.

### 3. Candidate fixes (do only the picked ones)
a. **Laminate sheen on the label.** Real film labels have a gloss varnish
   over both ink and foil. Switch the label to `MeshPhysicalMaterial` with
   `clearcoat ~0.6`, `clearcoatRoughness ~0.08`. That puts a sharp, colourless
   highlight over the matte ink.
b. **Foil too rough.** Metallised film is close to a mirror; 0.33 reads as
   brushed. Try `METALLIC_ROUGHNESS` 0.12–0.2 and compare it against the photo.
c. **Tone mapping.** ACES desaturates gold and pushes it toward beige. Try
   `THREE.AgXToneMapping` / `NeutralToneMapping` with exposure retuned. Pick by
   matching the gold in the photo, not by taste.
d. **Environment.** One studio HDRI gives every reflection the same windows.
   Try a softbox HDRI (CC0, e.g. Poly Haven). Expose `environmentRotation` so
   the highlight sweeps across the foil as the can turns. Credit the licence
   in `public/licenses`.
e. **Label edge.** A sticker has thickness. Add a 0.1–0.2 mm lip: a thin ring
   mesh at the top and bottom edges, or a slightly larger radius plus a
   darker edge band. This removes the "painted on" look.
f. **Grounding.** Replace the fake shadow plane with a real soft shadow
   (`shadowMap` PCFSoft from the key light, can casts, ground receives), or
   bake a contact-shadow texture once. Keep rendering on-demand.
g. **Ink over foil.** CMYK ink printed over bare silver should stay metallic,
   tinted by the ink (gold = yellow/red over silver). Check that the gold
   picks up a tinted reflection instead of reading flat yellow. If not, use
   the art colour as `specularColor` / tint in foil areas.

Each picked item: a constant or material change in `canScene.ts`, plus a
before/after pair in the PR. Any new pure helper (e.g. an edge-ring geometry
builder) gets a unit test next to `tests/canscene-bend.test.ts`. Disposal
must stay leak-free: extend `tests/canscene-dispose.test.ts` for any new
mesh, texture or material.

### 4. Performance check
Rendering is on-demand. Measure frame time on orbit drag before and after
(the Chrome performance panel is enough). Real shadows or a second HDRI must
not push a drag past ~16 ms on the maintainer's Mac.

### 5. Docs + release metadata
- Update the 3D view docs page in `docs-site` if any control was added (e.g.
  environment rotation).
- `CHANGELOG.md` `## [Unreleased]` → `### Changed`.

## Parallelism

1 → 2 → the picked 3x items in parallel (each touches separate constants;
merge order doesn't matter) → 4 → 5.

## Anti-goals

- No condensation, liquid or animated scenes.
- No new 3D library and no model replacement, unless task 1 shows the model
  itself is the problem.
- No settings knob for a value that has one right answer.
