# Configurable can lighting

Status: approved and implemented. The control is labelled **Lighting**, not **Light**: `Light` is already the theme option's translation key (es *Claro*, de *Hell*). Issue #570 (follow-up to #666).

## Why

#666 fixed the can's metal, but the side lighting still differs from the
studio photo: the photo darkens toward both edges, and the render's left edge
stays bright. No single fixed light rig matches every photo or every press
proof. The user asked for the lighting to be configurable.

## Scope (the simple version)

One control: **Light**, a slider in the Can view toolbar, beside **Curve**
(`src/App.tsx`, the `curvePct` slider). It turns the whole light rig (key,
fill and rim lights, plus the HDRI's reflections) around the can, from -180°
to 180°, with 0° as today's look. It's saved per operator in the existing
`lolev-view` localStorage entry, like rulers, guides and units.

Not in scope (ask before adding): intensity or exposure sliders, separate
per-light controls, HDRI choice, saving the light angle in `.label` files.

## Existing pieces reused

- `CanScene.setCurve` and the `curvePct` prop: `setLight` and a `lightDeg` prop
  follow the same pattern (`src/three/canScene.ts`, `src/components/CanView.tsx`).
- The Curve slider markup and its `title` tooltip (`src/App.tsx`).
- `VIEW_KEY` persistence (`src/App.tsx`, the read with guards and the write effect).
- three's `scene.environmentRotation` (r162+) rotates the HDRI's reflections.
  No custom shader.

## Tasks

1. **Scene API**: `tests/canscene-light.test.ts` first.
   - Files: `src/three/canScene.ts`.
   - Types: `setLight(deg: number): void`.
   - Change: put key, fill and rim in one `THREE.Group` (`this.rig`), and set
     `rig.rotation.y` and `scene.environmentRotation.y` to the angle in radians,
     then `requestRender()`.
   - Acceptance (vitest): after `setLight(90)` the key light's world position
     is rotated 90° about Y from its 0° position, and `environmentRotation.y`
     is π/2. `setLight(0)` reproduces today's positions exactly.
     `tests/canscene-dispose.test.ts` still passes (a Group needs no dispose).
   - Depends on: none.
2. **CanView prop**: test added to `tests/canview-lazy-dom.test.tsx`, or a small new DOM test.
   - Files: `src/components/CanView.tsx`.
   - Types: `lightDeg: number` prop.
   - Change: an effect calls `sceneRef.current?.setLight(lightDeg)`, like
     the curvePct effect.
   - Acceptance: changing the prop calls `setLight` once with the new value.
   - Depends on: 1.
3. **Toolbar slider + persistence**: `tests/view-state-dom.test.tsx` first (persisted value round trip).
   - Files: `src/App.tsx`, `src/locales/*.ts` (all five languages, no em dashes).
   - Types: `lightDeg` state (number, default 0), added to the `VIEW_KEY` JSON.
   - Change: a `Light` range input (-180 to 180, step 5) with a °
     readout, shown only in the Can view, using the Curve markup.
   - Acceptance: the value survives a reload, and a bad stored value falls back to 0.
   - Depends on: 2.
4. **Verify render** (no TDD, visual).
   - Use the measure-first skill. Screenshots at 0°, -60° and +60° with the
     same camera and label. Check that one setting darkens both edges like
     the photo. Frame time on orbit drag stays under about 16 ms (the
     rotation is a uniform, so there's no cost).
   - Depends on: 3.
5. **Docs + release metadata**.
   - Files: docs-site Preview page (Can view section), CHANGELOG
     `[Unreleased]` → `### Added`.
   - Depends on: 3.

## Parallelism

Sequential: 1 → 2 → 3 → 4, with 5 done alongside 4. Small enough for one agent
or inline work. It starts after #664 lands, because the locale files change
shape there.

## Migration

None. The value is a new optional key in `lolev-view`, and older stored
entries just lack it.
