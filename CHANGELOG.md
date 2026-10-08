# Changelog

User-facing changes to the Label Lab desktop application are recorded here.
Merged changes collect under [Unreleased] until a release is cut, which renames
that section to the new version (see .agents/release-steward.md).

## [Unreleased]

### Fixed
- **Saving can no longer wipe out a label or master.** Desktop Save writes a temporary copy beside the file and swaps it in only once it is complete, so a crash or full disk mid-save leaves the previous file intact.
- **Faster typing in the preview.** The white-ink plate is no longer repainted on every edit while the comparison divider hides it; it paints when the divider reveals it.
- **A malformed .label is refused instead of breaking the canvas.** A shared label whose values or overrides have the wrong shape (non-text values, non-numeric positions, an incomplete added layer) now fails to open with a clear error instead of crashing the preview or saving bad geometry back.

### Changed
- **Smoother typing in the 3D view.** The foil-mask pass over the label texture now runs in a background worker instead of stalling the editor on every rebuild.

### Security
- **Updater TLS fix.** rustls 0.23.45 closes RUSTSEC-2026-0285 in the update check's HTTPS connection.

## [0.1.104] - 2026-10-08

### Fixed
- **A label whose master can't be found asks instead of failing.** Open it on the current master or locate its `.master` file; values the master lacks are set aside, not lost.
- **Locate .master… says why it failed.** If the picked master can't be read, the error shows instead of the dialog silently asking again. A browser with no file picker says so.
- **A label keeps opening after its master file changed.** When the file a
  master was remembered at now holds a different master, a label still opens
  with its remembered copy every time, not just the first.
- **A restart reopens the master file that is on disk.** If the last master's
  file had been saved again as a new master over the same path, a new tab
  fell back to shipped Lolev on the first launch and only found the file on
  the next one. It now opens the file straight away.
- **A new tab keeps the master's own images.** Art placed in the master,
  such as a script logo, now shows when the app opens or a tab is added. Only
  the last beer's background, mask and Collab logos are left off.
- **The metallic mask accepts WebP.** Drop a .webp on the mask field or the mask half of the window chooser. The PDF gets a lossless PNG copy.
- **A WebP background stays WebP when you save.** The label and master files keep the image you dropped. Only the PDFs carry a PNG copy, because the PDF embed takes PNG and JPEG only.
- **A barcode's Solid background setting must be on or off.** A hand-edited
  file with any other value is reported instead of printing differently from
  what the inspector shows.

### Changed
- **Remove a master from the Master menu with the × on its row.** It sits at
  the right of each remembered master, so it no longer takes picking the
  master and waiting for its preview first. The master file stays where it is.
  From the keyboard, highlight the row and press Delete.
- **Every menu row has an icon, the ones macOS itself uses.** The Mac menu
  bar now shows the system's standard symbols on File, Edit and View rows,
  including the View checkmarks, and they follow light and dark mode. The
  browser menu draws the closest match for each.
- **Tauri 2.12.** The app shell, dialogs, file access and updater move to Tauri 2.12 (Rust and JS sides together), with three.js 0.186.1.
- **Node type definitions 26.** Build-time only; the app itself is unchanged.

## [0.1.103] - 2026-09-29

### Added

- **Remembered masters can be removed from the library.** Pick one in the
  Master menu, then Remove. That drops it from the list on this computer,
  including an older copy the app had remembered. The master file stays
  where it is.

### Fixed

- **A label keeps the master file's latest save.** Opening a label whose
  master was saved again over the same file uses that file. It no longer
  reopens an older copy remembered from the previous save, and reopening
  the label keeps the file's current template.

- **The browser matches the desktop icon and menu symbols.** The tab shows
  the Label Lab mark. A menu row shows a symbol in the browser only when the
  Mac menu shows one, and it is the same symbol.

## [0.1.102] - 2026-09-28

### Fixed

- **Barcode white ink follows the stroke.** The mask outlines each bar and each digit the way the artwork does. A box around the digits no longer prints white ink past the halo.

## [0.1.101] - 2026-09-28

### Changed

- **A barcode stroke can be a halo or a solid background.** The stroke
  still outlines the bars and the digits. Solid background, off unless you
  turn it on, fills the barcode box with the stroke colour so a textured
  label stays clear around the code. Preview, PDF and PSD all follow it.

## [0.1.100] - 2026-09-27

### Changed

- **Stroked QR codes no longer sit on a solid square.** The quiet-zone
  backing added in 0.1.99 is gone; a QR stroke outlines its modules again,
  in the preview, PDF and PSD.

### Fixed

- **Images promoted into a master stay with it.** Ticking a label's image
  in the Save Master review now writes the image itself into the .master,
  including when a variant such as Collab is on, so reopening the master no
  longer drops it. If the label never had the image file, Save Master now
  says so instead of saving quietly without it.

## [0.1.99] - 2026-09-27

### Changed

- **Desktop runtime updates.** Tauri 2.11.6 and the dialog, file, updater and
  single-instance plugins move to their latest patch and minor releases.
- **Library updates.** React 19.3, Base UI 1.8, Three.js 0.186 and the Tauri
  dialog, file and updater plugins move to their latest minor releases.
- **Build toolchain updates.** The app is now bundled with Vite 8 (Rolldown)
  and tested with Vitest 5; no change to how it looks or behaves.
- **Number fields in the inspector now accept only numbers.** Letters (like
  the "e" in "1e2") can no longer be typed into a size, spacing, position,
  or render setting. When you leave a field it always shows the value that was
  applied, and text that isn't a number (a lone "-") goes back to it. Arrow
  keys now step by the same amount as dragging the label (for example, letter
  spacing moves 0.1 pt per press instead of 0.01 pt), in millimetres as well
  as points; Alt+arrow steps finer. Dragging a label moves one step per pixel
  at any pointer speed, so dragging back to the start restores the value.
- Internal cleanup with no operator-visible change: a retired developer
  comparison page, the unused PDF-rendering dependency it pulled in, and the
  superseded first-generation master model are gone. Old `.master` and
  `.label` files still open exactly as before.
- Internal: the code is now linted (React hook rules and unused code) on
  every change; a few unused imports and an unused font-measure state were
  removed. No change in behavior.
- **Faster startup and smoother typing.** The 3D can view now loads the
  first time you open it instead of with the editor, cutting the startup
  code by about 40%. The label preview also stops re-reading the logo and
  QR shapes on every keystroke.
- **A crash no longer blanks the window.** If the editor hits an error it
  cannot recover from, it now shows the message and a Reload button instead
  of an empty page.
- **Opening files keeps working after an internal error.** If an internal
  error interrupted queuing a double-clicked `.label`, every later file open
  could crash the desktop app; it now carries on.
- **Shared labels cannot point the app at arbitrary files.** A `.label`'s
  remembered master path is only read when it sits beside the label or
  beside a master you already registered; otherwise the error asks you to
  open that `.master` once.
- **The desktop window enforces a content security policy.** Only the app's
  own bundled code and assets may load; nothing from the network.
- **Internal cleanup, no visible change.** Unused code and an unused
  interface component were removed from the app. Labels, exports, and the
  editor behave exactly as before.

### Fixed

- **QR codes scan on any texture.** A stroked QR now sits on a solid square
  of its stroke colour that covers the code and its four-module quiet zone,
  in the preview, PDF and PSD, so light art no longer shows through it.
- **Exported PSDs open at print size.** A PSD now records its export
  resolution (600 ppi by default), so Photoshop, Preview and Finder show it
  at the label's physical size instead of as a 72 ppi image roughly eight
  times too large.
- **Barcode backgrounds stay clear on textured labels.** A continuous backing
  covers the bars, digits and quiet zones across preview, PDF and PSD.
- **Exports report cancellation and partial saves.** Cancelling artwork stops
  the paired export, and a failed mask save names the artwork already saved.
  Unsupported font characters report their names before print files are written.
- **File dialogs follow one save policy.** Native Master Save As writes the chosen
  name once; cancelled and refused writes retain their existing save identity.
- **Colours identify master-writing actions.** Save Master, promotions and layer
  additions use the attention accent; destructive controls use readable text colours.
- **Windows and Linux offer Help → Check for Updates.** The comparison divider
  works by keyboard, and the sidebar uses the same collapsible layout at every width.
- **Keyboard editing keeps its place.** Cancelling text restores the prior saved
  state; formatting preserves authored case; layer deletion and reordering keep
  focus and announce changes. Guides, swatches and the can preview work by keyboard.
- **Updates protect unsaved tabs.** Restart waits for saving, Windows checks again
  before installing, and failed updates remain visible with a retry action.
- **Inspector controls match their behavior.** Hex colors accept shorthand,
  scrubbing stays steady when modifiers change, and page art explains its fixed fit.
  Rejected file drops and master switching now explain what happened.
- **Paragraph endings keep natural spacing.** Justification expands only wrapped
  continuation lines, including rotated text, across preview and exports.
- **Shortcut hints match the platform.** Windows and Linux show Ctrl and Shift,
  and Save Master As identifies the new file it creates.
- **Saving protects edits made while a file is writing.** Newer edits remain
  unsaved, and Save Master preserves them. A failed browser write reports an
  error; cancelling Save As keeps the original save target.
- **Bad labels and image loads report errors without replacing the open work.**
  Archives skip unrelated files and Finder metadata, and reject assets above
  128 MiB or a combined unpacked size above 256 MiB.
- **Legacy label-only layers can be inspected, moved, edited and removed.**
  Save Master also lists changed margins and document settings accurately,
  and distinguishes resetting a variant override from deleting a layer.
- **Switching masters preserves variant precedence on return.** New variants
  receive unused names. Each arrow-key press is its own undo step (a held key is
  one), and barcode resizing keeps module widths free of floating-point noise.
- **Edits during a save and in-place cancels keep their state.** A promotion
  survives edits made while Save Master writes, and cancelling in-place text after
  a save marks the tab unsaved. A loaded image no longer hides other messages.
- **Label-only layers keep their contents.** Their values survive a master
  switch, the inspector no longer offers to reset their fields, and a label whose
  layers can't be drawn fails to open instead of closing every tab.
- **Editor input no longer changes the wrong thing.** Bold across a line break
  keeps the text, typing a hex colour applies only complete colours, Add layer
  keeps the new layer selected, and 3D can arrow keys no longer move the layer.
- **Exports finish in more cases.** A slow browser export downloads when the
  save picker is refused, and ™️ ©️ ®️ from the emoji picker print.
- **The command line prints what the app prints.** It includes a label's own
  legacy layers and accepts overrides valid under the label's enabled variants.
- **Saving a master while switching masters keeps each in its place.** Opening
  another master during a Save Master write keeps its save target, and a promoted
  layer deleted during the write no longer drops the other promotions.
- **Layer and variant edits no longer fail on stale state.** Deleting with a
  stale selection removes the rows that exist, reordering a label-only layer no
  longer errors, restored variants keep their precedence, and a recreated variant
  never inherits a deleted one's id.
- **Label files stay openable.** Saving refuses an image over the size limits
  that opening enforces, and opening checks each image's real unpacked size.
- **Barcode backgrounds match the barcode box.** The backing fills exactly the
  box used for selecting and snapping; Code 128 gains a 10-module quiet zone so
  it never prints past the trim.
- **Controls behave consistently.** ⌘B works from the inspector, a cancelled
  touch no longer swallows the next tap, guides can't be added while hidden,
  Continue runs once, render errors show after a cancelled export, focus stays
  in place after deleting swatches and layers, and repeated reorders are announced.
- **Updates retry without downloading twice**, and a failed update check clears
  when closed.
- **The command line names unsupported image types** instead of only WebP.
- **QR error correction shows the actual default, L.**
- **Black text and vector artwork stay on the black plate.** PDF exports
  preserve neutral vector inks through CMYK conversion without turning
  colored artwork black. Raster images still use the printer’s color profile.
- **A pasted tab prints the way the preview shows it.** Text pasted from a
  spreadsheet (or any tab or other invisible control character, whether
  pasted, in a saved label or set from the command line) used to print as
  several spaces, shifting a centred line and overlapping the next run. It
  now prints as the single space the preview shows.
- **Closing a tab frees its images.** A closed tab used to keep its
  texture, mask, and image-layer art in memory for as long as the app stayed
  open. Closing it now releases them, and an image that fails to load no
  longer leaves a copy behind.
- **Dragging a layer back to where it started puts it back exactly.** Moving
  a layer away and then returning the pointer to its starting point (on one
  axis or both) used to leave the layer at its last offset on that axis. It
  now lands back where the drag began, and the drag is still one undo step.
- **The QR "followed by" picker shows what you picked.** It reads "nothing"
  or the text layer's name, matching its menu, instead of `none` or the
  layer's internal id.
- **The inspector's other dropdowns show their labels too.** Input, Symbology,
  Fit, QR style and Error correction read "Rich text", "UPC-A", "Cover",
  "Rounded" or "M (default)" instead of the raw `text`, `upc-a`, `cover`,
  `rounded` or `M`.
- **An image dropped on a switched-off variant's layer shows right away.** The
  layer's drop area names the loaded file instead of still saying "drop or
  click" until the variant is switched on.
- **Reordering a version's own layers now counts as a master change.**
  Moving a layer that only a version adds (such as Collab's Lead-in) up or
  down the layer list now enables Save Master and shows as "Reordered" in
  the Save Master review, instead of being silently dropped unless something
  else changed.
- **Deleting a version no longer hides the one you're working in.**
  Deleting any version other than the current one also switched off the
  current one; now only the deleted version goes away.
- **Deleting a version whose layer another layer is bound to now goes
  through.** Binding a layer below one a version adds (Volume below the
  Collab lead-in), then deleting that version, was refused with "bound to
  missing layer"; the bound layer now lets go and stays where it was.
- **Deleting a layer another layer is bound to on this label no longer
  freezes the preview.** A binding made in the inspector but not yet saved
  to the master (Volume bound below Logo, then Logo deleted) now lets go
  and keeps the bound layer where it was, instead of showing "bound to
  missing layer" with a stale preview. A binding saved to the master whose
  position was not also saved no longer jumps back to where it sat before
  it was bound.
- **`⌘K` no longer opens the command palette on top of an open dialog.** With
  the Save Master review or Settings open, `⌘K` does nothing; from the label
  it still opens the palette, and inside the palette it still closes it.
- **`⌘Z` inside an open dialog no longer undoes the label behind it.** With
  the Save Master review or Settings open, `⌘Z` / `⇧⌘Z` (and Edit → Undo /
  Redo) leave the canvas alone; in the inspector and its color picker they
  still undo your last edit.
- **Shortcuts no longer act on the tab behind an open dialog.** With the Save
  Master review, Settings or the command palette open, `⌘W` no longer closes
  the tab underneath, and `⌘N`, `⌘O`, `⌘S`, `⇧⌘S`, `⌘E`, `⇧⌘E` (and their
  menu items), `⌘B` (sidebar), the arrow-key nudge and the view keys
  `1`/`2`/`3`/`R`/`G` do nothing until the dialog is closed. With no dialog
  open, `⌘S` still saves from inside a text field.

## [0.1.98] - 2026-09-25

### Fixed

- **Undo brings back replaced or cleared layer images.** Dropping a new image
  on an image layer (or clearing it) and then pressing `⌘Z` restores the
  original art, instead of leaving the layer blank and saving a project with
  its image missing. Saved `.label` files also no longer carry images the
  label has stopped using.

- **Switching off a layer another layer is bound to no longer breaks the
  preview and export.** Turning off Description with Collab on (the collab
  lead-in hangs below it), switching to a version whose layers hang off a
  layer you turned off, or resetting a bound layer back on is now refused
  with a message naming the binding, instead of leaving the preview in an
  error state. Switch off or unbind the layers bound to it first.

- **Dropping a file on the window no longer replaces it.** A dropped
  `.label` now opens as a project, the same as File → Open Project… (in the
  current tab if untouched, otherwise a new one). A PDF, SVG, or other file
  the app doesn't take, dropped outside a file well, is ignored. Before,
  either one navigated the window to the file and lost every open tab.
  Textures and masks still drop as before.

- **Invalid entries stay in the field.** Typing an invalid barcode code (such
  as `ABC123`) or an out-of-range number (such as an ABV of `-3`) now leaves
  what you typed in the inspector field, marked invalid with the error
  beneath it, instead of snapping back to the master's code or going blank.
  The preview and exports still skip the invalid value.

- **The close-tab prompt now warns about unsaved master changes.** When the
  tab's master has changed (a layer added, removed, or reordered), the Save /
  Discard / Cancel prompt adds a line saying those changes will be discarded
  unless you Cancel and use File → Save Master. Save still saves the label
  and closes the tab.

- **Old labels with an ABV like "6.5%" open cleanly.** Labels saved when the
  ABV field carried its own percent sign no longer open with "Expected a
  number." and a blank ABV that blocked export; the sign is dropped on open,
  since the label already prints "% alc by vol".

- **Re-zipped label and master files keep their art.** A `.label` or
  `.master` that was unzipped and re-compressed with Finder or `zip -r` now
  opens with its texture and mask instead of an empty, nameless image.

- **Older JSON-only masters open even when an editor touched them.** A
  legacy `.master` saved as plain JSON now opens when it starts with a
  byte-order mark or a blank line, instead of failing with "invalid zip
  data".

- **Moving a label to another master and back restores all its text.** Text
  set aside while a label sat on a master without that field (including text
  carried over from older label files) now comes back when the label returns
  to a master that has it, instead of staying set aside for good.

- **PSD text sets with the same letter spacing as the PDF.** Editable type
  layers in exported PSDs now turn Photoshop's auto-kerning off, so Barlow
  Condensed text no longer sets tighter in Photoshop than in the PDF and the
  preview. Poppins labels are unchanged.

- **Collab SVG logos keep their rectangles, circles, and other basic shapes.**
  Shapes drawn as rectangles, circles, ellipses, polygons, polylines, or lines
  were dropped, so the rest of the logo was blown up to fill the slot (and a
  logo made only of shapes wouldn't load at all). They're placed now. An SVG
  that relies on clones, live text, or embedded images is refused with a
  message naming the element, instead of silently losing that part.

- **⌘S on a saved document no longer opens the browser's Save Page dialog.**
  In the browser, a shortcut whose command is unavailable right now (Save
  with no unsaved changes, Export while exports are blocked) now does
  nothing instead of falling through to the browser's own action for that key.

- **Editing text on the canvas no longer tightens the letters.** The on-canvas
  text editor now sets Barlow Condensed with the same letter spacing as the
  preview under it, so text stays put when you start typing. Poppins labels
  are unchanged.

- **An over-long QR value now shows a clear message.** A QR payload too long
  to fit in any QR code used to report a cryptic "code length overflow" (or
  an "undefined" error on export). It now says the value is too long, how
  many bytes it is, and to shorten it or lower the error correction level.

- **Set-aside style lines and barcodes in older labels come back.** When an
  older label's style line or UPC was set aside because its master had no
  place for it, moving the label onto a master that has one now restores the
  value instead of losing it.

- **Collab SVG logos load whatever quote style or line breaks they use.** SVGs
  written with single-quoted attributes, or with attributes on their own lines,
  were refused ("Logo path is missing d attribute"), and a single-quoted group
  transform was ignored, which put the art in the wrong place. Both now load
  and place correctly.

- **⌘S, ⌘O and ⌘E work while you are typing in a field.** In the browser,
  the ⌘ shortcuts (save, open, new and close tab, export) used to do nothing
  while a text field had focus, and ⌘S opened the browser's Save Page dialog
  instead. They now run from anywhere. Single-key shortcuts (1, 2, 3, R, G)
  still type into the field, and ⌘Z still undoes the field's own typing.

- **Opening a file brings Label Lab to the front on Windows and Linux.**
  Double-clicking a `.label` while the app is already running (even
  minimized) now restores and focuses the window, so the file's tab is in
  view instead of opening out of sight. Launching the app again from its
  icon also surfaces the running window.

- **Save Master lists only the layers you actually moved.** Moving one layer
  to a new place in the stack now shows a single "moved" row in the Save
  Master review, instead of flagging nearly every layer it passed.

- **Save Master review stays with its tab.** Opening or switching to another
  tab while the Save Master review is up now hides it until you return, so
  confirming can only write the master of the tab you are looking at.

- **View menu checkmarks stay put.** In the desktop app, choosing the view you
  are already in (View → Label while showing the label, or View → Can in the
  can view) no longer clears its checkmark.

- **Files opened while Label Lab is starting up open right away.** A `.label`
  double-clicked in the moment the app was still loading could sit unopened
  until the next file was opened; it now opens as soon as the app is ready.

- **Opening a file no longer replaces one you just opened.** A label opened
  through the Open dialog stayed "untouched" in the browser build, so the next
  Open silently swapped it out of its tab. Any opened label now keeps its tab,
  and the next Open goes to a new tab. Only an untouched Untitled tab is reused.

- **The on-canvas editor keeps an invalid entry, too.** After an invalid
  entry was rejected (such as an ABV of `25`), double-clicking the layer on
  the preview opened its editor on the master's value, or blank. It now
  shows the value you entered, the same one the error names and the
  inspector field shows.

- **Text formatting buttons work from the keyboard.** In a sidebar text field,
  Shift+Tab now reaches the Header, Bold, and White ink buttons instead of
  hiding them, and they apply to the text you had selected.

- **Dragged positions save as clean numbers.** Moving or resizing a layer on
  the canvas, and binding or unbinding one, now lands its position (and a
  resize its size) on the same 0.01pt grid the inspector types and the arrow
  keys nudge on, so Save Master
  shows `x: 292.56 → 193.09` instead of `193.08552000000003`.
- **Save Master names an edited text line.** A changed line reads
  `lines: 1 → 1 ("Old" → "New")` instead of the uninformative `1 → 1`.

- **A failed restart keeps the installed update.** If Restart Now fails,
  closing the error puts you back where you were: the status bar still offers
  Restart to finish, and Label Lab → Restart to Update opens the restart
  dialog instead of an empty one.

- **Switching to the 3D can view repeatedly stays smooth.** Leaving the can
  view now releases its graphics context right away, so toggling 2D and 3D or
  switching tabs quickly no longer piles up contexts until the browser starts
  dropping them.

- **Millimetre fields keep the number you typed.** Typing 50 in a millimetre
  position or size field no longer comes back as 49.999 on blur (or 10 as
  10.001). Fields show the shortest millimetre reading that stores the same
  value, and keep a third decimal only where it matters.

- **Every way of quitting on macOS asks about unsaved tabs.** Dock → Quit,
  logging out or shutting down, and AppleScript `quit` now run the same
  Save / Discard / Cancel prompt as `⌘Q` instead of quitting and losing the
  edits. With unsaved work open, Label Lab stops a logout or shutdown until
  you've decided; with nothing unsaved it quits right away as before.

- **The inspector stays 300px wide in a narrow window.** Below 640px it took
  three quarters of the window and covered the label. Above that it was 312px
  and overlapped the canvas by 12px. It is now 300px at every width, and the
  label recentres in the space beside it.

- **An empty QR layer draws nothing.** Clearing a QR layer's value used to
  print a real, scannable QR code for a single space. An empty QR layer now
  draws nothing on the canvas, in the PDFs, or in the PSD, the same as a
  barcode with an invalid number.

- **The development window always loads its own editor.** `npm run dev` now
  serves only on port 5173 and stops with an error if another app already
  holds it, instead of quietly moving to 5174 while the Label Lab dev window
  kept loading whatever was on 5173.

- **Command palette shortcuts line up on the right.** The key hints in the ⌘K
  palette now sit flush against the right edge of every row, instead of
  floating mid-row at a position that changed with each command's name.

- **Ruler numbers stay clear of the unit corner.** When a vertical-ruler
  number would run up into the corner box (e.g. "-0.5" over "in"), its label
  is left out; the tick mark still shows.

- **The drop overlay no longer flickers on macOS.** When you drag a texture
  or mask image across the window, the "Background texture / Metallic mask"
  overlay now stays up as the pointer moves over the canvas and panels. It
  used to blink off at every element edge in the desktop app. It still
  closes when you drag out of the window or drop.

- **Variant badges say what the variant did.** Hovering a layer's variant
  badge now reads "Changed by the Collab variant" on a master layer the
  variant only overrides, and keeps "Added by the Collab variant" for a
  layer the variant adds.

- **Number fields show the value they applied.** Typing a number in
  exponent form, such as `1e2` in Size, applied 100 but left `1e2` in the
  field after you clicked away. The field now shows `100`. This covers
  every inspector number field, including optional ones like wrap width.

## [0.1.97] - 2026-09-24

### Fixed

- **No more endless "rendering label…" spinner on a label with an error.**
  A value the label can't print (such as an invalid barcode) no longer stops
  the preview: it keeps drawing with the master's value in that spot, and the
  header's error message still blocks export until you fix it.
- **Escape inside the inspector no longer closes it.** Pressing Escape in an
  inspector field (to cancel a typed value or dismiss its suggestions), while
  editing text on the preview, or mid-drag now only cancels that action; the
  layer stays selected and the inspector stays open. Escape with no field
  being edited still closes the inspector.
- **Empty text layers stay clickable and editable.** A new Text layer, or one
  whose text you have deleted, keeps a small box on the canvas: you can click
  to select it, see its outline, and double-click to type into it. Deleting
  every character while editing on the canvas no longer closes the editor
  and sends your next keystrokes to menu shortcuts.
- **Removing a layer no longer moves the layers bound below it.** A layer
  bound below the removed one now takes its place exactly where the removed
  layer sat, even when that layer was positioned from a guide, anchored at
  its bottom, or bound to another layer. Previously it could jump to the top
  of the label or land below the vacated spot.
- **Save Master no longer fails when promoting a layer binding.** Binding a
  layer to another in the inspector and then promoting it in the Save Master
  review now writes the whole binding (target, side, and gap) to the master
  as one row, instead of throwing "invalid binding". If a promotion is ever
  rejected, the error now shows in the header instead of the save silently
  doing nothing.
- **A file that fails to open no longer takes over the tab.** If a `.label`
  can't be opened (for example its artwork won't decode), the tab now stays
  exactly as it was — still showing the previous file and still saving to it.
  Before, the tab showed the failed file's content while Save (`⌘S`) still
  pointed at the previous file, so saving overwrote it. A master that fails
  to open likewise no longer becomes the Save Master target.
- **Escape during a drag no longer undoes your previous edit.** A move or
  resize on the canvas is always its own undo step. Before, a drag whose first
  movement snapped back to where it started could merge into the edit you made
  just before it, so pressing Escape to cancel the drag (or `⌘Z` afterwards)
  took back that edit too.
- **Collab SVG logos with clipping paths now fill their slot.** SVGs exported
  with a clip path, mask, or other hidden definitions (Illustrator adds these
  routinely) were drawing that hidden shape as ink, which shrank the real logo
  to a speck. Commented-out shapes were drawn too. Only the visible artwork is
  placed now.
- **Desktop File → Open Project remembers where the file lives.** Opening a
  `.label` from the menu now uses the macOS open dialog, so `⌘S` saves back
  to that file instead of asking where to save, and opening the same file
  again (from the menu or Finder) switches to its tab instead of opening a
  duplicate.
- **Unsaved master edits now keep the close prompt armed.** Adding a layer
  (or any other master edit) and then saving the label with `⌘S` no longer
  lets the tab or window close silently: the tab keeps its unsaved dot, closing
  asks first, and the updater warns before restarting, until you save the
  master with Save Master.
- **Double-clicking a layer's name renames it again.** In the Layers list, a
  double-click on a row now opens the inline rename box, as it always should
  have; the row menu's Rename still works too, and dragging a row to reorder
  is unchanged.
- **Undo and redo from the keyboard mark the label unsaved again.** In the
  browser, pressing ⌘Z or ⇧⌘Z after saving now enables Save and makes closing
  the tab ask first, just like Edit → Undo/Redo, so an undone change is no
  longer silently lost.
- **Undo after inspector typing only undoes the typing.** Typing in an
  inspector field (Text, Link, Code, Value) is now its own undo step. Before,
  it merged into whatever you did just before it (a move, a toggle), so `⌘Z`
  took back both at once.
- **Collab SVG logos with quadratic curves now appear in the PSD.** Partner
  logos drawn with quadratic curves (common in some SVG exporters) rendered in
  the PDF but vanished from the Photoshop file; they now come out identical in
  both.
- **Save works for files opened from Finder and for remembered masters.**
  ⌘S on a `.label` opened by double-click (or from the command line), and
  File → Save Master on a master picked from the library after a relaunch, no
  longer fail with "forbidden path". `.label` and `.master` files inside hidden
  folders (such as `~/.something/`) can now be opened and saved too.
- **Quitting asks about unsaved tabs.** Label Lab → Quit (`⌘Q`) now walks
  every tab with unsaved work through the Save / Discard / Cancel prompt,
  the same as closing the window, instead of quitting and losing the edits.
- **Save Master no longer overwrites another master's file after undo.**
  Undoing back past Open Master, a library pick, or Save Master As used to
  leave Save Master pointed at the newer master's `.master` file, so saving
  wrote the older master over it with no dialog. Save Master now asks where
  to save whenever the document's master is not the one that file belongs to.
- **An invalid barcode can no longer drop silently off the print.** A bad code
  saved into the master (by promoting it in the Save Master review) used to
  clear the error and export without the barcode. Export now checks the code
  each barcode actually prints, after any `{layer}` refs expand, and blocks
  with an error when it isn't valid. A label barcode like `{textId}` that
  expands to a valid UPC no longer shows a false error, and a typed invalid
  code is no longer added to the barcode's picker.
- **Bold and white-ink spans across several words survive wrapping.** A
  span like `**GOVERNMENT WARNING:**` or `_very hoppy double_` in a wrapped
  or justified text layer (including the rotated warning column) now keeps
  its style on every word, in the preview, PDF, and PSD, instead of printing
  literal `**` / `_` markers in the regular face.
- **PSD export no longer stretches textures and masks.** A texture or mask
  whose shape differs from the label page (a square image, for example) now
  lands in the Photoshop file cropped the same way as the PDF and preview,
  instead of stretched and shifted.
- **PSD strokes keep their width at any export DPI.** Text keylines, vector
  art, and QR strokes in an exported PSD now print at the same physical
  width as the PDF when Settings → Resolution is not 600 DPI. At 300 DPI a
  1.8pt keyline is 7.5px instead of a doubled 15px, matching the barcode
  halo.
- **Barlow Condensed text prints where the preview shows it.** Exported PDFs
  and PSDs now position text with the same letter spacing the file is drawn
  with, so centred Barlow Condensed lines stay centred, right-aligned lines
  no longer run past their margin, and mixed bold or white-ink runs no longer
  overlap. The preview draws that spacing too, so screen and print agree.
  Poppins labels are unchanged.
- **QR codes scan back non-ASCII text exactly.** Accented letters, symbols
  like `€` and `—`, and emoji in a QR layer are now encoded as UTF-8, so
  phones read the same text you typed instead of garbled characters or
  nothing at all. Plain ASCII QR codes (such as beer URLs) are unchanged.

## [0.1.70] - 2026-09-23

### Fixed

- **Selecting a layer no longer puts the cursor in its name field.** The
  inspector opens without taking focus, so Delete/Backspace removes the
  selected layer and the arrow keys nudge it, instead of quietly editing the
  layer's name.

## [0.1.68] - 2026-09-15

### Fixed

- **Untitled tabs load the last master without the last beer.** File → New
  Tab (`⌘N`) still opens onto the last master you applied — its layers and
  positions — but not that master's fill values or raster art, so the canvas
  is Untitled on bare stock instead of a previous beer name and its texture.

## [0.1.67] - 2026-09-07

### Changed

- **Black-and-white menu icons.** The in-window glyphs follow the menu text
  color, including Undo, Redo, and the View checks (Label, Mask, Can, Rulers,
  Guides). The macOS menu uses AppKit template images only, so they tint with
  the bar instead of drawing in color.

## [0.1.66] - 2026-09-07

### Changed

- Menu tests walk the same File/Edit/View table the app uses. No operator-visible
  change.

## [0.1.65] - 2026-09-07

### Added

- **Menu icons.** File and Edit items show a leading icon in the in-window
  menubar, and the macOS application menu uses matching template images
  where AppKit ships one.

## [0.1.64] - 2026-09-07

### Added

- **Headless generate from a master.** `npm run generate -- beer.master values.json out`
  fills a `.master` from JSON (one job or a batch), with `--variant`, `--asset`,
  `--set`, `--format`, and `--label`; `--inspect` prints the fill contract. The
  old texture/mask/config form still works.

### Changed

- The document title and export filename rule live in one place shared by the
  app and the CLI, so both name a label identically.

## [0.1.63] - 2026-09-06

### Fixed

- A new untitled document reopens the last master you applied, instead of
  always starting from the shipped Lolev template. The last-applied id is
  recorded only after the master bytes are stored, so a reload cannot miss
  them and fall back to Lolev.

- The desktop app can re-read `.master` files from disk (Open Master uses
  the native dialog and remembers the real path), so a restart finds the
  template you last used instead of falling back to the shipped one.

## [0.1.62] - 2026-09-06

### Added

- **Snapping to other layers, on both axes.** Dragging or resizing a layer now
  lines it up with every other layer's edges and middle, not only with the
  master's guides — and with the guides pulled off the rulers, which in turn
  snap to the layers. A group still snaps as a group, on its own bounds.

- **Alignment indicators.** The line a gesture caught is drawn from the layer
  being moved to the far end of whatever it lined up with: fuchsia for another
  layer, blue for a page guide. A badge alongside reads out the distance
  travelled while moving, and the width and height while resizing.

- **Arrow-key nudge.** Arrow keys move the selected layers one point, or ten
  with Shift held. Inert while typing or while a menu is open.

- **Promote every override at once.** Save Master's review offers a single tick
  for all of a label's overrides instead of one per row.

### Fixed

- A master saved or opened in a browser is remembered, so reopening a label
  finds the operator's own template instead of silently falling back to the
  shipped one. The desktop application always read the file from disk and is
  unaffected.

- Millimetre fields no longer lose precision: a value typed back exactly as
  shown now matches the template again, so its override can be cleared.

- Keyboard shortcuts and the arrow keys stand aside while a menu, dialog or
  dropdown is open, instead of acting on the label behind it.

- Text run controls (Header, Bold, White ink) no longer appear before the text
  is focused, where they could not act on anything.

## [0.1.61] - 2026-09-06

### Changed

- Show estimated characters per inch for the densest line of text at print size.

- Toggle uppercase for an entire text layer from the sidebar or on-canvas editing toolbar without losing its original capitalization.

- Choose Poppins or Barlow Condensed per text layer, with matching preview, printed-height measurements and exports.

- Set a minimum printed character height in millimeters and see the tallest letter or numeral, measured from the export fonts without decorative outlines. Point-size editing remains available.

- Choose millimeters or points for inspector positions and dimensions; font sizes remain in points.

- Display numeric controls at their editing precision, avoiding long decimal tails on imported text sizes.

- Group typography controls together in the right sidebar and move template field settings into an expandable section after appearance controls.
- Clarify spacing labels, keep field guidance visible, and enlarge override reset targets for easier use.

## [0.1.60] - 2026-09-06

### Added

- **A new colour scheme.** Warm neutrals with six accents — purple, pink,
  orange, yellow, green and cyan — each with a tint for small text and one
  for row backgrounds. Every committed pair is checked for AA contrast in
  both light and dark.
- **A variant is marked with an icon** in the version menu instead of an
  indent, so it reads as a version of the master above it.
- **Save Master now shows what it is about to write.** Every save opens a
  review listing each change: renames, added and removed layers, reordering,
  fill-contract edits, and edits made inside a variant. Cancelling writes
  nothing.
- **Your own edits can be folded into the template from that review.** Moving,
  restyling or resizing a layer is now this label's change, not the
  template's — the review offers each one for promotion, unticked, and only
  the ones you tick are written.
- **Fill fields can offer a list.** The Style field offers Lolev's styles and
  the Barcode field offers the eight tiers by name, filling their UPCs. Both
  still take anything typed, and a value you type joins the list — which the
  Save Master review shows before it reaches the file.
- The Layer inspector authors that list: a Title caption for the field, and
  the choices themselves.
- A QR or barcode value follows a field instead of being fixed text, so the
  Lolev QR is an ordinary editable setting rather than a hardcoded URL. (How
  that is authored changed again below — see the link editor.)
- Rotation now works on QR layers, matching text and barcodes.
- Clicking the pasteboard around the label deselects, which closes the
  inspector. Dragging a guide or removing one does not.

### Changed

- Toggle uppercase for an entire text layer from the sidebar or on-canvas editing toolbar without losing its original capitalization.

- **A QR code is edited as a link, not a template.** The inspector now asks
  for the URL and which field follows it, and makes that field safe for a
  link automatically — lowercased, with spaces and punctuation turned into
  dashes. Barcodes lose the token chips and the transform hint that came
  with the old template box.
- **Text fields are readable again.** The description field no longer paints
  a layer's artwork colours into the input, where gold and white were hard
  to read and white ink was invisible outright. White ink now shows as a
  dotted underline. Colours still appear on the label preview.
- **A layer's placeholder is drawn on the label only.** The field beside it
  no longer repeats it.
- **The master Select is now the version picker.** Variants are listed under
  their master, and the one you switch to is the one the canvas draws and the
  one a promotion is written into. The variant chips beside the Layers filter
  are gone, and New Variant moved into that menu.
- **Save Master As… now forks.** It mints a new master, rebinds the document
  onto it and writes the file, taking its name from the file you save as. The
  sidebar's "Duplicate as new master…" and its duplicate "Open Master…" button
  are gone — the File menu already had the latter.
- The Layers filter reads "Changed" and shows the layers this label has
  touched, replacing "Fillable only". Every layer is fillable now.
- Uppercase moved from the text layer to its Style, alongside Letter Spacing.
  A master authors it, a label turns it off through the ordinary style
  override with a reset badge, and the stored text keeps its typed case — so
  a name drawn as ULTRA JUICE still resolves `{name|slug}` to `ultra-juice`.
  Masters authored before the move are read unchanged.
- Opening the inspector no longer covers the artwork: the preview pane makes
  room for the sheet and the label recentres in what is left.
- The inspector's Enabled / Locked switches are ordinary labelled rows like
  every other control, and the panel has roomier padding. (The Fillable switch
  is gone entirely — see below.)

### Fixed

- A vocabulary field no longer forgets what you typed. Typing a barcode or a
  style and then clicking away kept the old value — only Enter or picking from
  the list committed it. Escape still cancels.
- Switching on a layer that only a variant adds no longer moves the version
  you are editing. The master Select silently retitled to that variant, and
  the next Save Master wrote every promotion into it instead of the template.
- A choice's value can be cleared and retyped. Emptying the box raised an
  error in the menu bar that stayed up, and the text sprang back.
- The Title you give a fill field is now shown above every field, not just the
  ones offering a list.
- Resizing a layer whose horizontal guide differs from its anchor keeps the
  opposite edge still, as the vertical axis already did.
- Dragging two layers at once no longer moves a layer bound to another one in
  the selection twice as far as the pointer.
- A multi-layer drag now snaps as a group, on the selection's own bounds,
  instead of re-spacing itself whenever the grabbed layer crossed a guide.
- Layers no longer jump when dragged across roughly a quarter and two-thirds
  of the way over the label — a drag no longer re-anchors the layer to the
  nearest guide as it passes.
- Switching from a variant back to the master hides that variant again.
- Editing a QR payload wrote the *expanded* URL back to the master, replacing
  the `{name|slug}` token with whatever beer name happened to be filled in.
  The template is now preserved separately from its expansion.
- The Rotation toggle no longer appears on image layers, where no backend
  honoured it.
- The QR URL slug and the export filename now share one machine-name rule
  instead of two copies that could drift.
- **Add choice** now adds a usable row. It used to submit a blank value, which
  the master rejects, so the whole edit was discarded and no row ever appeared.
  New rows arrive named "New choice", numbered when that name is taken.
- **Save Master As** now rebinds the open label onto the fork it just wrote.
  The label kept pointing at the master it was forked from, so saving the
  project afterwards recorded the original and reopening loaded that template
  instead of the fork.
- Promoting a cleared property into a variant now keeps it cleared. Clearing a
  wrap width on the label and promoting it into a variant restored the
  template's width, because a missing key in a variant means "inherit".
- A layer that a variant adds now shows reset badges for your own edits to it.
  Resizing Collab's Graphic logo, for instance, created a label override with
  no way to reset it from the inspector.

## [0.1.57] - 2026-09-05

- The inspector's Position section now has one control per axis: Horizontal
  guide (left / center / right) and Vertical guide (top / middle / bottom).
  Picking a guide snaps that edge of the layer onto it and turns X / Y into
  offsets from the guide. The separate Anchor, Edge and Detach controls are
  gone; a center guide is new. Layers positioned by an absolute X / Y still
  load and draw exactly as before, showing no guide until one is chosen.

- Layers can be resized on the preview from any corner or side of the
  selection frame: the grabbed edge follows the pointer and the opposite
  edge stays put. Images and barcodes stretch freely; hold shift to keep
  their proportions. QR codes always scale uniformly. Text layers resize
  their wrap width only, since type size is set in the inspector. Escape cancels a resize in
  progress, and the whole drag is one undo step.

## [0.1.56] - 2026-09-05

- Label Lab now quietly re-checks for a new release whenever its window regains
  focus, at most once every six hours, so an app left running for days notices
  releases without a relaunch. Nothing is downloaded until you choose Install.

## [0.1.54] - 2026-09-05

- Dragging a layer on the preview now moves every selected layer together.
  Only the grabbed layer snaps to guides; the others follow it exactly, so the
  group keeps its shape. Locked layers stay put.

- Dragging a selected row in the Layers list (or ⌥↑/⌥↓ on it) reorders every
  selected layer together as one block, keeping their relative order.

- A multi-selection shows a dashed group frame with a layer count on the
  preview, and every row in the group lifts while one of them is dragged in
  the Layers list, so moving several layers reads as one gesture.

## [0.1.53] - 2026-09-05

- Choosing “Check for Updates…” while an update is downloading now shows the
  download's progress instead of an empty dialog, and “Restart Now” reports a
  failed restart instead of doing nothing.

- Layers a variant changes (the ones marked with a dot) reorder among the
  master's layers again, by drag and by Alt+Up/Down; they had been grouped with
  the variant's own added layers.

- Also in this release, previously shipped but unlisted: drag layer names to
  reorder them with a drop-position indicator (keyboard reordering remains
  available with Alt+Up/Down); the range/add selection hint sits below the layer
  list, the divider below the master selector is gone, and the master selector
  is the standard shadcn Select with Open Master and Duplicate actions below it.

## [0.1.52] - 2026-09-05

- Show “Up-to-date” with a circular checkmark icon in the update status.

- Polish the update dialog: show the version jump (current → new) under the
  title, label the release notes “What's new”, and keep wrapped changelog
  bullets on one item. Install closes the dialog and shows a spinner with the
  download percentage in the lower status bar.

- Install updates without an immediate restart: the status bar then offers
  “Restart to finish”, and the macOS Label Lab menu's “Check for Updates…”
  becomes “Restart to Update”. Windows still restarts during install, since its
  installer closes the app.

- Make layer reordering smoother by updating its indicator only when the drop
  position changes. Moving guides reuses loaded images, and preview drawing,
  hit testing, and selection outlines share measured layer positions.

## [0.1.50] - 2026-09-05

- Show “Up to date” in the lower status bar after a successful update check,
  including after closing the manual check dialog.

## [0.1.49] - 2026-09-05

- Bind a layer to the top, left, right, or bottom of another layer. Bound layers
  follow their neighbor's size with an adjustable gap, including chained bindings.
  Dragging adjusts the gap; switching sides, unbinding, and removing the neighbor
  preserve the freed position. Existing “Bind below” files remain compatible.

## [0.1.48] - 2026-09-05

- Added left/right margin-guide bindings alongside top/middle/bottom. Horizontal
  and vertical bindings work together, follow margin changes, and keep adjustable
  offsets when dragged. Detaching preserves the layer's position.

## [0.1.47] - 2026-09-04

- Added a middle guide anchor: keep a layer vertically centered between the
  top and bottom margin guides as its content grows, with an adjustable offset.

## [0.1.46] - 2026-09-04

- Anchor a layer's top or bottom edge to its margin guide from the inspector,
  with an adjustable offset. Bottom-anchored text grows upward; dragging adjusts
  the offset, and detaching preserves position.
- Margin changes now save with the master and move guide-anchored layers in
  preview and exports.

## [0.1.45] - 2026-09-04

- Turning on a dimmed variant layer now activates its variant instead of
  accidentally disabling the layer and triggering a binding error. The power
  button reflects whether the layer is actually enabled in the current variant;
  undo restores both the variant and layer together.

## [0.1.44] - 2026-09-04

- Available desktop updates appear in the lower status bar without interrupting
  work. Click the version to review release notes and install; choosing Later
  keeps the update available from the bar, across tabs.

## [0.1.43] - 2026-09-04

- Masters now contain editable layers; variants store changes to those layers.
  One Layers list with a Fillable filter replaces the separate editing modes,
  Fields and Document panels. Every text layer supports rich multiline editing.
- Position any unlocked layer, or bind it below another so it follows growing
  text. Variant edits stay with the variant, including position changes.
- Preview, PDF and PSD exports share layer placement. Existing master and label
  files convert on open; newly saved files use format version 3.

## [0.1.42] - 2026-09-04

- Presets are gone: the saved beer-style and barcode lists, the "Saved
  styles…" / "Saved barcodes…" pickers in the inspector, and File → View /
  Import / Export Presets. A master is the saved style, and a barcode is
  typed on its layer. Document Settings (corner radius, edge softness,
  resolution, bleed) and saved color swatches now live in the app's own
  per-machine storage; on the first launch after this update they start from
  the defaults once.
- The preview has three views instead of five: Label (1), Mask (2) and Can
  (3). The separate Rendered flat-label view is gone, and the four-pack is a
  1 / 4 count switch in the Can view's toolbar rather than a view of its own.
- View has two toggles instead of seven: Rulers (R) and Guides (G). Guides
  shows the trim line, the margin and center guides and the manual guides
  together; the separate Bleed Lines, Margin / Center / Manual Guides and
  Clear Manual Guides items are gone. A manual guide is removed with the ×
  that appears in the ruler when you hover it (dragging it back onto the
  ruler and Delete still work).

## [0.1.41] - 2026-08-29

- Internal cleanup of the new master-container and PSD collab code (shared
  packing helpers, one raster-drawing rule, parallel export decodes). No
  visible behavior change; picking a library master no longer reads its file
  twice.

## [0.1.40] - 2026-08-29

- A saved `.master` now carries its template art: the texture, the metallic
  mask, and any master-owned image layers' files travel inside the master, so
  a new label from a master needs nothing re-dropped. Labels keep their own
  embedded art when they have it (a label's art always wins), and `.master`
  files saved by earlier versions still open unchanged.

## [0.1.39] - 2026-08-29

- PSD exports now include the Collab partner art: a "Collab" layer group with
  the lead-in text and both partner logos, on the art plate and (as a
  white-ink footprint) on the mask plate. Previously the exported PSD of a
  Collab label silently omitted the partner logos entirely.

## [0.1.38] - 2026-08-28

- Fill mode no longer shows variant checkboxes. Labels that already have a
  variant enabled keep its fields, artwork, and saved values unchanged.

## [0.1.37] - 2026-08-27

- Design mode now edits the master — the shared core every label inherits —
  instead of the label in front of you. Restyle the name, move the QR, lock
  the logo, switch a layer off: it applies to every label made from that
  master from now on. For a one-off, pick or create a variant from the new
  "Editing" selector in the Design sidebar and the change is recorded there
  instead, ready to enable whenever you need it; properties a variant changes
  are badged, and each can be reset back to the master. Masters save and open
  as `.master` files and register themselves in the library, so a label can
  find its master again — or be re-aimed at another one, with anything that
  does not carry over kept on a bench rather than dropped. Any layer with
  editable content can be made fillable from the inspector, and a layer added
  in Design mode now belongs to the master rather than to the one label in
  front of you.
- Collab is no longer a special case. It is an ordinary variant carrying the
  two partner logos, which you fill from the field list like anything else and
  switch on and off from the same checkbox every variant gets. The lead-in
  line above them stays fixed template art. Labels saved with the old collab
  switch open with the variant already on and look exactly as they did.
- Fixed: a layer added in Design mode could not really be edited. Dragging,
  restyling, renaming, locking or deleting one appeared to work and then
  silently reverted, and deleting was impossible — the layer came straight
  back. Reorder arrows could also be shown for moves that did nothing.
- Fixed: edits to the built-in Lolev master were lost when a label was
  reopened, even after saving the master to a `.master` file. A saved master
  on disk now wins over the built-in one, as it always should have.
- Fixed: editing a beer name, ABV or other fillable text directly on the
  canvas in Design mode reverted, and wrote that one label's text into the
  master, where every other label would have inherited it.
- Fixed: a duplicated master could not be saved, and a label pointing at one
  could not be reopened afterwards.
- Fixed: opening a `.master` whose variant added an unrecognised layer crashed
  the whole sidebar.
- Fixed: custom barcodes printed wrong. The human-readable digits overprinted
  the bottom of the bars instead of sitting in the space reserved below them,
  the white-ink plate extended twice as far past the ink as intended, and a
  UPC-A or EAN-13's outer digits were not counted in its width — so a
  right-aligned one could push its check digit off the trim edge. Custom
  barcode layers on existing labels shift as a result; Code 128 is unaffected.
- Fixed: a custom image layer whose artwork had not loaded still stamped a
  solid white-ink rectangle into the exported PSD, under artwork that never
  printed.
- Fixed: replacing a field image left the old one behind, growing every
  `.label` saved afterwards; and dropping a damaged image failed silently
  instead of reporting the error.
- The layers panel now lists front to back — the layer you'd click on top
  sits at the top of the list — instead of back to front. The up arrow on a
  custom layer now moves its row up the list as well as forward, and the
  down arrow moves it down as well as back, so the arrows finally point the
  way the rows move.
- A custom layer's name can now be renamed right in the layers panel —
  double-click it, same as a built-in layer — instead of only from the Name
  field in the inspector.

## [0.1.36] - 2026-08-27

- The layers panel now lists the label's real layers in drawing order, in one
  flat list, instead of the fixed Beer / Collab / Template groups. Each layer
  is declared by the master, so a layer can be renamed, switched off, or
  locked there rather than being hardwired into the app — the wordmark is now
  "Brand", and the government warning ships locked. The collab block is no
  longer a special section with its own switch: its three layers belong to the
  Collab variant and appear when it is enabled, marked with a Collab badge
  while it is off. Custom layers can be moved forward and backward in the
  stack.

## [0.1.35] - 2026-08-27

- "Variation" is now called **Variant** throughout — the Collab checkbox, the
  data model, and the `.label` file format, which stores the enabled variants
  under a renamed key. A `.label` saved before this release still opens, but
  its enabled variants are forgotten and need re-checking once. No other
  behavior changed.

## [0.1.34] - 2026-08-27

- The layers panel's empty Custom group now reads just "No custom layers".

## [0.1.33] - 2026-08-27

- The Design/Fill control moved from the top menubar row to the right end of
  the preview toolbar at the bottom of the window, beside the view readouts.
  No behavior change — same two buttons, same keyboard/palette commands.

## [0.1.32] - 2026-08-27

- Design mode can now add layers: text, image, barcode (UPC-A, EAN-13,
  Code 128, with human-readable digits and a show/hide knob), and QR
  (square/rounded/dots; error correction defaults to M, with a warning when
  a Code 128 module is set too narrow to scan). Barcode and QR payloads can
  be built from label fields with a chip-based format editor and live
  preview. Custom image layers now actually render — their bytes travel
  inside the `.label` file — and the PSD exports carry every custom layer
  plus the square/rounded QR styles they previously dropped. Custom text
  layers support bold and letter-spacing; image hit areas now match portrait
  artwork exactly.

## [0.1.31] - 2026-08-27

- Labels now run on a master + variations + values model. A new Design/Fill
  control (Fill is the default) shows fillers just the label, a field list,
  and variation checkboxes — the collab switch is now the shipped Collab
  variation. Files save in a slimmer v2 `.label` format recording the master,
  enabled variations, and values; existing `.label` files still open exactly
  as before, and re-saving upgrades them. The app keeps a library index of
  where `.master` files live; the Lolev master ships built in.

## [0.1.30] - 2026-08-27

- Custom text and image layers: a label file can now carry extra layers that
  draw in the 2D preview and both print PDFs, positioned by left/center/right
  and top/bottom anchors so alignment survives content changes. Drag them
  anywhere on the label; dragging near a safe-area guide snaps to it (and
  the highlight shows which guide engaged). A new Lock toggle on movable
  elements — including the laurel and collab logos — makes them inert to
  dragging. There is no UI to add custom layers yet, so existing labels are
  unaffected; custom image layers position but do not paint until image
  assets are wired up in a later release.

## [0.1.29] - 2026-08-27

- More groundwork for masters and variations: EAN-13 and Code 128 barcode
  encoders (verified against the published symbol tables), a barcode
  geometry that can draw any symbology, QR style options (square, rounded,
  or the current dots look) with a selectable error-correction level, and
  validation for the new code types. Nothing in the app calls any of it
  yet — no visible or behavioral change in this release.

## [0.1.28] - 2026-08-27

- Groundwork for masters and variations: a new internal data model that can
  describe a label template (master), stackable named overrides (variations),
  fillable fields with validation, derived text like QR URLs, and a slimmer
  `.label` format that can be re-aimed at a different master. Nothing in the
  app uses it yet — no visible or behavioral change in this release.

## [0.1.27] - 2026-08-26

- Wide keylines no longer eat small glyph features in the preview. A period,
  the dot on an i, and the counters of characters like % and 8 were showing
  white bites out of their outline — the on-screen renderer's stroke leaves
  unpainted cavities where a wide outline folds over itself, which the
  exported PDFs already worked around. The preview and the 3D views now use
  the same remedy, so what is on screen matches the printed plate. The PDFs
  and the PSD were never affected.
- Editing the ABV on the preview no longer leaves a gap between the number
  being typed and "% alc by vol": the field is measured with the same metrics
  the artwork is drawn with instead of guessing a digit's width, so the unit
  sits where the finished render puts it.

## [0.1.26] - 2026-08-26

- No behaviour changes. This release only adds automated coverage for the
  description editor's on-screen formatting — the part that turns bold and
  white-ink markers into styled text and back again — so the two ways it once
  lost those markers while typing cannot come back unnoticed.

## [0.1.25] - 2026-08-26

- Backgrounds now accept WebP alongside PNG and JPEG, by drop or file picker.
  A WebP is decoded and kept as PNG in the project and both PDFs, since the
  PDF embed handles PNG and JPEG only. The mask is still PNG-only, so a WebP
  dropped on the mask half of the chooser lands on the background.

## [0.1.24] - 2026-08-26

- Opening several .label files at once from Finder no longer drops all but
  the last one — each file gets its own tab.
- Hiding a collaboration logo no longer removed the "A collaborative project
  with" lead-in from the exported PDF while the preview kept showing it. The
  lead-in now follows its own eye in both.
- The 2D preview rasterizes at the density it is actually displayed at
  instead of oversampling past it, and releases that density when you zoom
  back out — noticeably less work per keystroke.
- "Open With" on a non-.label file is now ignored instead of surfacing an
  open error, and a .LABEL file opens like a .label one.
- Fresh installs get their seed preset library back (styles and Tier
  barcodes) — an accidental dev-server writeback had emptied it.
- A failed file open no longer permanently blocks re-opening that file, and
  a project saved under a new name no longer intercepts opens of its
  original file.
- An upload or export failure now stays in the error strip until it is
  actually resolved, instead of vanishing on the next keystroke; failures
  while a 3D view is rebuilding its textures now reach the strip too.
- The preview no longer renders distorted after changing bleed at maximum
  zoom, and tracked text renders correctly on macOS WebViews older than
  Safari 17.4.
- Internal: launching by file no longer crashes on non-Unicode command-line
  arguments; the font family parameter is now required through the canvas
  backend; the collab slot envelopes have one shared spelling between
  placement and hit-testing.

## [0.1.23] - 2026-08-26

- Double-clicking the description on the 2D preview now edits it in place
  over the artwork with a compact floating toolbar, instead of opening a
  panel that duplicated the field.

## [0.1.22] - 2026-08-25

- Internal: font pipeline is config-driven internally; typeface choices
  arrive with font sourcing.

## [0.1.21] - 2026-08-25

- Drag the laurel and collab logos vertically on the 2D preview; one undo
  step per drag.

## [0.1.20] - 2026-08-25

- Internal: the PSD builder now places layers from the shared display list
  instead of computing its own layout; exported PSDs are byte-identical.

## [0.1.19] - 2026-08-25

- The preview now renders directly on canvas from the shared display list —
  2D updates land per keystroke with no debounce, in-place editing hides the
  edited element instantly, and the 3D views texture from the same plates.
  PDFs and PSDs are built only on export; exported files are unchanged.

## [0.1.18] - 2026-08-25

- Internal: the shared display list now covers the whole label (laurel, QR,
  collab logos, barcode), and a new canvas renderer draws both plates from
  it — groundwork for the direct-canvas preview, behind a dev-only flag.
  Exports are unchanged; a parity harness (npm run parity) checks the two
  renderers against each other.

## [0.1.17] - 2026-08-25

- Internal: text placement is now computed once (a shared display list)
  and consumed by both the PDF renderer and click-target hit-testing,
  groundwork for the direct-canvas preview. No visual or output changes
  intended.

## [0.1.16] - 2026-08-25

- Double-clicking any editable text on the 2D preview — beer name, style,
  ABV, description, volume, info line, or store cold — now edits it in
  place: the label re-renders live as you type, in the element's true style.
  The description opens the same WYSIWYG field as the sidebar over its block
  (buttons on top of the field; markdown only behind its "Edit as Markdown"
  toggle), and the rotated info / store-cold lines edit in a small field at
  the element. Enter or clicking away ends the edit (one undo step for the
  whole session), Escape restores the old text. The ABV editor accepts only
  the number — its "% alc by vol" tail stays fixed.

## [0.1.15] - 2026-08-25

- Fixed hidden tabs reverting the shared DPI and bleed settings during
  background re-renders, which could skew rulers, size readouts, and exports
  until the active tab refreshed.
- Typing the beer name no longer re-renders the whole editor twice per
  keystroke to retitle the tab.
- Double-clicking a .label file twice in quick succession now focuses the tab
  already opening it instead of opening the same file in two tabs.
- Closing the window right after changing Document Settings no longer loses
  that change — the pending save completes before the window closes.

## [0.1.14] - 2026-08-25

- Fixed the preview losing its image with "Preview asset bytes were not sent
  to the worker" when switching back to a tab while several tabs are open.
- Tab and window titles now always show the beer name as typed ("Untitled"
  while blank), instead of switching to the saved file's name after Save.

## [0.1.13] - 2026-08-25

- Update dialog polish: release notes render with styled headings and bullets
  instead of raw markdown text, the release date sits next to the version in
  the header, the download shows a themed progress bar with "X MB of Y MB",
  and a manual update check shows a spinner while it looks for a release.
- Switches match the current shadcn look — larger track and thumb — and turn
  royal blue when on instead of purple.
- The document Settings layer now uses a gear icon.
- Presets persist in the browser: a build with neither the desktop backend nor
  the dev server now saves the library to localStorage instead of losing it.
  Desktop and dev storage are unchanged.

## [0.1.12] - 2026-08-24

- No user-visible changes: hardening around workspace tabs. The rules for
  where an opened file lands, tab titles for unusual paths, and the OS
  file-open queue are now pinned by unit tests (including the app's first
  Rust tests), with small internal refactors to make them testable.

## [0.1.11] - 2026-08-24

- Workspace tabs: several .label projects can be open at once in one window,
  each in its own tab with its own undo history, unsaved-changes state, and
  save target. ⌘N opens a new tab and ⌘W closes one; closing a tab (or the
  window) with unsaved work asks Save / Discard / Cancel per tab.
  Double-clicking a .label file now opens it in a new tab — or focuses the
  tab that already has it — instead of replacing the current document.
  Works in the browser build too. Several files opened at once (or in quick
  succession) each get their tab — none are dropped — and uppercase .LABEL
  extensions open correctly on Windows and Linux.

## [0.1.10] - 2026-08-24

- Label Lab now runs on Windows and Linux: releases add a Windows installer
  (setup.exe) and a Linux AppImage built for Debian 13 "trixie" and newer,
  both with the same automatic updates as macOS. Double-clicking a .label
  project opens it in the app on every platform — including into an
  already-running window.

## [0.1.9] - 2026-08-24

- Wide text outlines in Label Lab previews now close cleanly around punctuation
  and other tiny glyphs, matching Photoshop at the dynamically selected stroke
  width instead of leaving white cavities. Print geometry is unchanged.

## [0.1.8] - 2026-08-24

- Zoomed 2D previews now redraw from the PDF at the current zoom and display
  density, keeping small punctuation and fine stroke details crisp instead of
  stretching a low-resolution bitmap. Preview memory remains capped at a
  600-DPI-equivalent canvas.

## [0.1.7] - 2026-08-24

- Text outlines now render as true strokes instead of stacked offset copies,
  fixing white gaps inside the outline around small glyph features — dots on
  i and ü, the counters of % — and the subtly scalloped outline edge. Applies
  to every stroked text element and the barcode digits' halo; barcodes still
  scan (verified by decoding the rendered pixels).

## [0.1.6] - 2026-08-19

- Default save and export filenames are now machine-friendly slugs of the
  beer name — lowercased with spaces and punctuation turned to dashes, the
  same rule the QR code URL uses ("Peregrine Falcon" saves as
  peregrine-falcon.label / .pdf / .psd).
- Internal cleanup of the menu wiring and the project-open pipeline following
  review; opening a project behaves exactly as before, including the quiet
  retries for files that fail their first read.

## [0.1.5] - 2026-08-18

- Restored Cut, Copy, Paste, and Select All in the desktop app, including the
  standard keyboard shortcuts while editing any text field.

## [0.1.4] - 2026-08-11

- Registered the .label file type with macOS: double-clicking a project in
  Finder (or Open With / dropping it on the Dock icon) now opens it in Label
  Lab, including while the app is already running, and Save rewrites the
  opened file.
- Made the stack nudge apply only while Collab is enabled: turning Collab off
  returns the laurel to its default position, while the saved nudge value is
  kept for the next collab release.

## [0.1.3] - 2026-08-11

- Fixed Save Project As and file exports in the desktop app so they open the
  native Save dialog instead of behaving like browser downloads.
- Made Save Project reuse the file chosen by Save As for later edits.

## [0.1.2] - 2026-08-11

- Matched barcode white-ink stroke corners to the rounded artwork and PSD
  strokes, removing small mask overhangs at bar and digit corners.

## [0.1.1] - 2026-08-11

- Added New Project with an unsaved-changes confirmation, a standard keyboard
  shortcut, and a clean document/history reset.
- Restored full-window and inspector-field image drops in the packaged desktop
  app.
- Added independent white/metallic layer assignments for outer strokes,
  defaulting every stroke to white/non-metallic with matching PDF and PSD mask
  output.
- Changed mask handling: uploaded masks are embedded in the mask PDF exactly
  as authored (no more recoloring or palette validation), the 3D preview now
  detects foil by brightness so any ink color works, and the default foil
  edge softness is now 0.

## [0.1.0] - 2026-08-11

- Added the first Label Lab desktop release for Apple Silicon and Intel Macs.
- Added signed in-app updates backed by a public update feed while keeping source
  code and installer releases private.
