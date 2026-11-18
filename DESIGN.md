---

> Scope: this document preserves SeerJourney’s visual design history. For current campaign behavior, follow PRODUCT.md and docs/user-guide.md. The campaign edition selects a map at deployment (no first-run map library); bookmark fields use accessible custom icon/color pickers backed by form values. Earlier standalone import-screen and native-select descriptions below are historical.
name: SeerJourney
description: A living field journal with a full-screen map and restrained glass controls.
colors:
  canopy-green: "#216d51"
  expedition-ink: "#17342b"
  muted: "#596e64"
  faint: "#6e8076"
  line: "rgba(41, 69, 54, .12)"
  danger: "#a73431"
  focus: "#2c8161"
  white: "#fff"
  glass-start: "rgba(255,255,255,.86)"
  glass-end: "rgba(237,245,231,.69)"
  glass-border: "rgba(255,255,255,.72)"
  solid-glass: "#f1f7ed"
  input-fill: "rgba(255,255,255,.56)"
  marker-brass: "#e7bd6a"
  marker-fern: "#88c7a0"
  marker-coral: "#ef8e7b"
  marker-river: "#8ec4e6"
  marker-orchid: "#c2a7e5"
typography:
  display:
    fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.7px"
  log-title:
    fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif'
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.7px"
  journal-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.7px"
  dialog-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.17
    letterSpacing: "-0.7px"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  tool-label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  field:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  form-label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "1.15px"
  metadata:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  input: "13px"
  search: "15px"
  row: "12px"
  option-group: "18px"
  toast: "20px"
  button: "23px"
  capsule: "25px"
  journal: "27px"
  phone-panel: "28px"
  dialog: "29px"
  dock: "32px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
components:
  button-primary:
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "#1f6246"
    textColor: "{colors.white}"
  button-subtle:
    backgroundColor: "rgba(77,110,84,.09)"
    textColor: "#3b5946"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
  button-subtle-hover:
    backgroundColor: "rgba(77,110,84,.16)"
  button-danger:
    backgroundColor: "rgba(164,52,49,.07)"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "10px 13px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.expedition-ink}"
    padding: "0px"
    width: "44px"
    height: "44px"
  input-text:
    backgroundColor: "{colors.input-fill}"
    textColor: "{colors.expedition-ink}"
    typography: "{typography.field}"
    rounded: "{rounded.input}"
    padding: "11px 13px"
  map-tool-dock:
    textColor: "{colors.expedition-ink}"
    rounded: "{rounded.dock}"
    padding: "7px"
    height: "64px"
  brush-selector:
    textColor: "{colors.expedition-ink}"
    typography: "{typography.tool-label}"
    rounded: "{rounded.phone-panel}"
    padding: "5px"
    width: "256px"
    height: "56px"
  title-capsule:
    textColor: "{colors.expedition-ink}"
    rounded: "{rounded.capsule}"
    padding: "8px 5px 8px 16px"
    height: "64px"
    width: "308px"
  utility-controls:
    textColor: "{colors.expedition-ink}"
    rounded: "{rounded.phone-panel}"
    padding: "5px"
    height: "56px"
    width: "152px"
  trip-day-choice:
    backgroundColor: "transparent"
    textColor: "{colors.expedition-ink}"
    typography: "{typography.tool-label}"
    rounded: "22px"
    padding: "8px 12px"
  game-log:
    textColor: "{colors.expedition-ink}"
    padding: "24px"
  journal-panel:
    textColor: "{colors.expedition-ink}"
    rounded: "{rounded.journal}"
  option-row:
    backgroundColor: "transparent"
    textColor: "{colors.expedition-ink}"
    typography: "{typography.body}"
    padding: "12px 16px"
  marker-row:
    backgroundColor: "transparent"
    textColor: "{colors.expedition-ink}"
    rounded: "{rounded.row}"
    padding: "10px 8px"
---

# Design System: SeerJourney

## Overview

**Creative North Star: "The Living Field Journal"**

The map commands attention. Calm, precise controls support discoveries that accumulate into a living field journal. The interface feels light, familiar, and dependable, with glass overlays separating actions from terrain.

Components are refined and restrained. The serif wordmark recalls an atlas; the Sea and Sky sigil expresses navigation, and system typography keeps controls usable. Sources are `src/client/styles.css`, `src/client/index.html`, `src/client/app.js`, `src/client/features/game-log/game-log.js`, `src/client/features/map/journey-view.js`, and the commitments in `PRODUCT.md`. `preview.jpg` and `preview-iphone.jpg` show the map composition; `preview-game-log.jpg` and `preview-trip-dialog.jpg` show the daily writing surfaces.

**Key Characteristics:**

- A full-screen map with floating controls.
- Mist Glass overlays and Canopy Green action states.
- Precise shared alignment and dependable touch targets.
- A title and Search at the upper left, with compact Game log, Help, and Options at the upper right.
- A journal that adapts between floating panel and bottom sheet.
- Explore by default, with a batch brush, daily log, and markers one action away.
- A chronological game log whose mapped days become a visible journey.

## Colors

Canopy Green, Expedition Ink, and Mist Glass give the controls a quiet relationship with the map's landscape.

### Primary

**Canopy Green** (`canopy-green`) marks the Sea and Sky identity sigil, caret, and readout dot. Button and selected-tool gradients are recorded in `.impeccable/design.json`.

### Sea and Sky identity

The approved SeerJourney mark is a refined nautical sigil inspired by **Seer of Sea and Sky**. An eye-shaped horizon contains a star with a long north point; a wave below supplies the sea reference. Keep this silhouette consistent across the app icon and chrome. The Explore control retains the functional compass icon.

The app icon uses an ocean gradient from `#285f5d` to `#103b3e`, a pearl eye (`#f5efdb`), a gold star (`#e7bd6a`), and a sea-glass wave (`#a8cec2`). These are identity-asset colors, not new global interface accents. The transparent chrome mark uses Canopy Green (`#216d51`) in the title, loading state, blank canvas, and Help. `tools/generate_icons.py` shares vector geometry across `icon.svg`, four opaque app-icon PNGs, `seer-mark.svg`, and the transparent 512px `seer-mark.png`. Keep the symbol within the maskable safe circle. The size study is `previews/seerjourney-logo-sizes.png` (16, 24, 32, 36, and 64px).

### Neutral and semantic colors

**Expedition Ink** (`expedition-ink`) carries primary text. `muted` supports descriptions and placeholders; `faint` serves the journal footer. The Game log and small trip dialog locally use the existing field-label tint (`#435e4d`) for muted text, keeping secondary text readable on their selected-day surfaces without changing the map palette. **Mist Glass** combines `glass-start`, `glass-end`, and `glass-border`; `solid-glass` is its reduced-transparency alternative. `line` separates related content. `danger` identifies destructive actions; `focus` identifies keyboard position.

Brass, Fern, Coral, River, and Orchid are selectable marker colors. Marker symbols provide an additional distinction. Brass also identifies the latest mapped camp; other day stops and journey lines use Canopy Green, with pale outlines separating them from terrain. Selected and hovered tiles use translucent warm fills and thin outlines, separate from action-state greens.

**The Annotation Rule.** Use marker colors for map annotations, including Brass for the current camp; keep the established green treatments for interface actions.

## Typography

The frontmatter records exact font stacks and roles: serif display text and system sans controls, headings, and notes. No external fonts or uniform modular scale are implemented.

The full-screen Game log heading uses the serif log-title role and becomes 28px in compact list views; the compact detail heading is 26px. Compact day rows use 16px day labels and 14px previews. The noninteractive atlas title becomes 22px on phones and short landscape layouts while retaining its 28px line-height. Phone dialog titles become 24px. Tool labels become 12px at 350px and below and in short landscape. Trip-day numbers use tabular numerals; daily notes retain 16px text with 1.75 line-height. Caption text is 11px and uppercase; metadata stays compact. Form fields retain 16px text. Scale labels are 11px; scale and coordinate readouts use tabular numerals.

## Layout

Controls overlay the full-screen map; opening the journal never resizes it. The workspace clips overflow without scrolling; journal and dialog contents scroll internally.

Use the six spacing steps. Shared chrome gutters are 20px by default, 16px on phones, and 12px in short landscape, added to safe-area insets. The chrome gap is 12px. The title capsule sits at the upper left, includes Search at its right end, and is capped at 308px. It uses an 8px gap and 5px right padding. The separate Game log, Help, and Options group sits at the upper right in a 152px-wide capsule. The title yields to the group with a 12px gap as available width narrows. The journal aligns with the right gutter beneath the utility group, has an independent width capped at 320px, and retains a 20px content inset. The tool dock is independently centered and capped at 360px. Top controls share a centerline; scale and readout share a baseline. Preserve border-aware 5px and 7px control padding.

The brush selector is centered 12px above the dock while the brush is active. The main dock keeps its bottom position. The layout variable `--dock-stack-height` equals the dock height in Explore, Log, and Marker, and includes the selector height plus the chrome gap in Brush. Compact status, zoom, history, toast, and floating-journal constraints reserve this stack; short-landscape zoom retains its base dock offset to stay clear of the top controls.

| Condition | Adaptation |
| --- | --- |
| Width ≤1100px | Status moves above the full dock stack; zoom sits above status. |
| Width ≤700px | History moves left above the full dock stack; the map hint hides. |
| Width ≤1000px, outside compact Game log mode | Game log uses a 160px day rail and stacks the map snapshot below notes. |
| Width ≤600px | Journal becomes a bottom sheet, capped at 72dvh and the visual viewport. The dock becomes 72px high with icons above labels. |
| Compact Game log: width ≤600px, or width ≤1000px with height ≤500px | Show a full-width vertical day list. Tapping a day opens only its editor; All days returns to the list. The day field is 96px wide; note height is min(360px, 42dvh) with a 240px minimum. |
| Width ≤480px | The title identity mark hides. |
| Width ≤380px | The active map name and next day stack. Trip-dialog actions use a two-column footer. |
| Width ≤350px | Tool labels shrink; marker actions use a two-column footer. |
| Landscape, height ≤500px, width ≤950px | Top/dock rows become 56px; the brush selector becomes 48px with 1px padding; status hides; the journal becomes a constrained panel on the right. The four zoom/journey buttons form a two-by-two group at the base dock offset. |

Small task dialogs center inside the safe rectangle and follow the visual viewport. The Game log fills the available visual viewport with safe-area padding. Its wide layout uses a 192px day rail, a flexible writing area, and a location/snapshot column. The day rail and editor scroll internally; the header stays available. Compact list rows scroll vertically and have no horizontal rail. Compact details hide the day list and Add day action, then center the day heading between All days and Close. Its layout is one continuous writing surface with dividers, rather than nested content cards. Keyboard-open journal constraints apply across phone, tablet, and short landscape layouts.

## Elevation & Depth

Depth is structural: lifted overlays separate controls from the map. Mist Glass uses a 135-degree translucent gradient, a light border, inset highlights, ambient shadows, and `blur(24px) saturate(1.65)`. Small dialogs use a denser 145-degree material, a deeper shadow, and a blurred backdrop. The full-screen Game log uses a near-opaque Mist Glass gradient without backdrop blur, keeping longer notes readable and scrolling text stable while preserving the atlas material. Exact gradients and shadows are recorded in the sidecar.

**The Lift Rule.** Use elevation to distinguish the interaction layer while retaining the map as the visual anchor.

Press feedback scales icon buttons to .92. The title is a static identity surface without button hover or press feedback. Control transitions take .15s. Journal closing combines .2s opacity, .25s transform, and delayed visibility. Opening timings vary with the existing responsive cascade; the sidecar records that distinction. Loading pulses the identity mark from .65 to 1 opacity over 3s without rotation. Reduced motion disables transitions and animation.

## Shapes

Rounded rectangles and capsules define controls; icon buttons and marker discs are circular. Radii follow the frontmatter, with 28px phone panels and a 25px short-landscape journal. Borders and highlights clarify edges over terrain.

## Components

**Buttons and navigation:** refined, restrained, and explicit. Action buttons have a 48px minimum height. Icon buttons are 44px square. The four equal dock segments run Explore, Log, Marker, Brush from left to right, with Explore selected on launch. The brush segment is labeled Reveal or Refog to reflect its current action. History stays independent of the centered dock.

**Brush selector:** a compact Mist Glass pill appears above the dock for the entire time Brush is selected. Reveal and Refog have equal segments with eye and fog icons; the selected action uses a pale raised surface and deep green text. The selector is capped at 256px wide, with 44px minimum targets. It is hidden in Explore, Log, and Marker; its appearance reserves space without moving the main dock.

**Map interaction:** Explore drags to pan, selects an empty hex, and opens an existing marker's note. Brush paints one hex or a continuous path, with a whole completed stroke as one undo step. Two-finger navigation rolls back an unfinished first-finger stroke; Escape, pointer cancellation, and lost capture also roll it back. Space plus drag or the middle mouse button pans while brushing. E/B/R/H/M select Explore, the current Brush, Reveal brush, Refog brush, and Marker. L selects Log for adding a day at a hex, G opens the full Game log, and J toggles the main journey. The cursor distinguishes navigation from painting.

**Title, search, and options:** the upper-left title capsule contains the Sea and Sky mark, noninteractive active map name and next trip day, and Search at its right end. The next day remains visible on narrow phones. Expedition counts live in the Search panel, in three equal columns ordered explored, marked, and revealed, with 8px gaps at every width. The rightmost value pairs a 24px revealed count with a muted 14px slash and fixed initially-fogged total. Search is an always-visible magnifying-glass button inside the title capsule. Game log, Help, and Options form the upper-right utility group. Search shows a pale pressed surface while the journal is open. It opens the right-aligned journal on larger screens; the phone journal remains a bottom sheet. Header, search, content, and coordinate fields share inner edges. Option rows align icons and chevrons in 24px columns around flexible text. Save session exports a backup; Load session restores one. The options menu has no Share session action. Long marker titles and previews truncate within their rows.

**Trip-day editor:** a small dialog places the chosen location before day number and plain-text notes. When a hex has multiple entries, a horizontal row of 44px day choices exposes each existing day plus New day. The selected choice uses a pale green surface and deep green text. Renumbering preserves the entry; removing a location retains its notes. Deletion is explicit and confirmed.

**Game log:** a full-screen header pairs the serif title and entry summary with an Add day plus icon and Close. The header Add day and new-entry save use round 48px plus buttons; the empty state uses the text action Add your first day. Deletion uses a round 48px trash button. Every icon action retains an accessible label and title. Existing entries keep the text label Save changes, and deletion still requires confirmation. Larger layouts use a day rail with flat, 64px-minimum rows. Compact layouts open a full-width vertical list with 84px-minimum divided rows, a strong day label, a note preview, and a trailing chevron; recorded-day gaps remain visible. Tapping a row opens its note. The compact detail header shows All days, the current day or New day, and Close, with the global summary and Add day action hidden. The selected row uses a pale green fill. The editor keeps Trip day, the save action, the trash action, and a plain textarea visible as distinct tasks; location controls and a map snapshot sit alongside or below the writing area. Unsaved text is guarded before closing, returning to the list, or switching. The snapshot uses current fog and the day's incoming mapped segment, even when the main-map journey is hidden.

**Journey overlay:** green route lines have a pale casing. Segments between consecutive game day numbers are solid; segments that skip one or more day numbers are dashed, including when intervening days have notes but no mapped location. Main-map routes and incoming-segment snapshots use the same treatment. Day pins retain a 44px hit area and fixed visual size as the camera zooms. The latest mapped stop uses a Brass camp symbol. Several days at one stop fan apart, with longer stays grouped under a count and managed in the trip dialog. The Search panel’s explored count measures distinct route tiles, while its revealed count still measures fog changes.

**Fields and dialogs:** softly filled editor fields use visible labels; search and session fields retain accessible names. Keyboard focus, including the search wrapper, uses a 3px outline with a 3px offset. The journal scroll area starts with 8px padding. The Game log editor extends its scrolling box with −8px left and −16px right margins, balanced by 8px left and 16px right padding. Content stays aligned while the right gutter keeps the overlay scrollbar clear of focus outlines; compact editors keep automatic width. Inputs, selects, and textareas have 8px block scroll margins, and dialog, journal, and log-editor scrollers have 8px block scroll padding so focus outlines remain visible. Disabled buttons reduce opacity. Preserve internal scrolling and narrow action layouts. Compact Help uses the same ≤600px or ≤1000px-with-height-≤500px condition as the Game log: its heading and upper-right close icon stay fixed while instructions scroll. The compact view hides the identity mark, keyboard-shortcut grid, and bottom return button; the larger-screen layout retains them.

**Map markers:** camera counter-scaling preserves a 44px hit area around a 26px disc. The symbol and outline share the selected marker color. In the marker editor, Marker and Color use native selects inside relative, minimum-width-zero wrappers. The two fields share equal `minmax(0, 1fr)` columns with a 12px gap. Native picker behavior remains intact; `appearance: none` replaces only the closed control chrome. Selects use a 48px minimum height, 24px line height, and 40px right padding. The existing chevron icon rotates 90°, measures 16 × 16px, and sits 13px from the right edge, centered vertically with pointer events disabled.

## Do's and Don'ts

### Do:

- **Do** preserve shared gutters, centerlines, and content edges.
- **Do** retain safe-area, keyboard, and internal-scroll behavior.
- **Do** keep reduced-transparency, reduced-motion, backdrop-filter fallback, and forced-color treatments.
- **Do** retain visible keyboard focus and the existing touch targets.

### Don't:

- **Don't** stretch the journal into a permanent map-resizing sidebar.
- **Don't** replace the supplied map artwork with decorative substitutes.
- **Don't** treat marker colors as interchangeable global action accents.
- **Don't** infer native-device validation or accessibility certification from this record.

Format reference: [DESIGN.md specification](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). Token values and component behavior were extracted from this application.


## Map library extension

SeerJourney retains the Living Field Journal visual system. The first-run welcome uses the existing glass dialog over a blank pale canvas: Import map mod leads, the included Chult map is secondary, and AI preparation guidance is progressively disclosed. Your maps reuses that dialog with a compact list of installed maps and per-map exports. The upper-left capsule shows the active map name and next game day; the application and Home Screen name are SeerJourney. Long map names truncate within the capsule. New functional text uses 13–16 px, and primary import/row actions retain touch-sized targets.
