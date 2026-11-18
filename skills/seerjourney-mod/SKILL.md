---
name: seerjourney-mod
description: Prepare supplied campaign map images as portable SeerJourney map mods, including hex or square grid calibration, original label extraction, fog rules, and icon-anchored discovery. Use for creating or updating map packages; not for building the SeerJourney application or inventing campaign geography.
---

# Create a SeerJourney map mod

Produce an importable `NAME.seerjourney-mod.json` and retain its editable manifest, source attribution, and extraction/calibration notes. This skill ships with [the mod format](references/map-mod-format.md) and a [standard-library packer](scripts/pack_mod.py). Keep the whole skill folder when downloading or sharing it; `SKILL.md` alone omits those resources.

Read the format reference before writing metadata. Use the established `mapjourney-mod` JSON format identifier; SeerJourney preserves it for compatibility with existing mods. When working inside a SeerJourney checkout, `src/shared/map-mod.js` is the runtime authority if the bundled reference has drifted. Do not alter the application to accommodate a malformed mod.

## Inspect and preserve the sources

Identify the supplied map variants: clean terrain, player/default labels, revealed labels, and any actual terrain fog. Open the images, record their dimensions, and compare the same landmarks before extracting pixels. Images with matching dimensions can still be shifted or differently cropped. Fit translation/scale or a justified registration from stable terrain and grid intersections, then inspect several widely separated landmarks. Keep one logical coordinate system for the background, grid, tag crops, and icon anchors.

Use the clean terrain as background when it exists. **A clean, unlabelled background must not imply fog-free terrain.** Preserve blank terrain tiles from the supplied default/FoW reference as a separate fog layer. Reconstruct that reference’s initial state by combining the clean terrain, terrain fog, and its extracted known labels. Distinguish these independent choices:

- Terrain starts visible, with only secret labels withheld.
- Terrain starts fogged in listed cells, with a fog image or solid color.
- Labels already known to players are always visible.

Only choose label-only discovery when the user’s brief or source state establishes that terrain starts visible. Otherwise retain the source’s terrain fog. Ask only if a material choice remains unclear. Do not infer a hidden place name from unrelated lore or add labels absent from the supplied revealed map.

## Calibrate the printed grid

Determine square, flat-top hex, or pointy-top hex. Fit centers and spacing from many printed intersections across the map, not a single cell. Store origins at cell centers, inclusive index limits, and the actual interactive map frame. Read the reference formulas for the supported offsets. Independent X/Y scaling may preserve an existing raster’s proportions; skewed grids need rectification.

Render a diagnostic outline overlay and inspect corners, center, and clipped boundary cells at readable zoom. Test center hit locations and brush routes across the map. Keep the original cell meanings when updating a mod used by saved campaigns; otherwise give the new coordinate system a new map ID.

## Extract labels without duplicating terrain

Use deterministic image operations on the supplied pixels. Preserve the original writing and symbols. For aligned images, use their differences to locate candidate ink/backplates; suppress JPEG compression noise and inspect every resulting crop. Avoid a blanket color threshold that removes similarly colored label ink, or opaque rectangular crops that visibly replace terrain.

**Every tag already present in the default/FoW reference remains always visible, even if its icon lies in a fogged tile.** Only extra tags absent from that reference are conditional on discovery. Match labels by their **meaning and icon location**, not pixel overlap alone. A default label may move or be restyled in the revealed map. It remains one default label; a shifted copy is not a newly discovered location. Group multiline names with their corresponding icon. Separate unrelated nearby labels, and remove map furniture from candidate location tags.

Create transparent PNG crops with tight margins. Track each label’s source variant and whether it is default or hidden. Produce a contact sheet with IDs and icon anchors for review. If exact alpha recovery is impossible, preserve original backplates where they belong and state the residual limitation; do not silently redraw, invent, or omit difficult labels.

For every hidden label, locate the actual map icon, convert that point to a grid cell, and store both `cell` and `anchor`. The trigger is never the center of the text or crop. Ensure the cell appears in `fog.cells`. The whole label appears together when its icon cell is revealed, even when the text spans several cells. Default geographic labels with no icon can stay `always` visible without a trigger.

## Package and prove the result

Choose a stable, campaign-specific map ID and a positive integer `revision` (default `1`). Increment the content revision for compatible asset or fog corrections; it is separate from schema `version` and does not imply automatic updates. Create a development manifest with raster paths inside its folder, then run:

```sh
python3 /path/to/seerjourney-mod/scripts/pack_mod.py /path/to/map.json --output /path/to/campaign.seerjourney-mod.json
```

The packer needs only Python 3. It embeds images and checks package safety; it does not prove grid accuracy or label classification. Validate the output with the current app’s `MapJourneyMods.validate`, then import it through SeerJourney to decode the images and install it.

Inspect default, partially revealed, and fully revealed composites beside their source variants. Check all extracted tags, not only the largest names. For a representative hidden label, reveal a neighboring cell containing only its text, reveal its icon cell, and refog that icon cell. Confirm the label appears only after the icon cell is revealed. Confirm default labels remain present throughout, including those whose icons sit on unrevealed terrain. Check that the initial blank terrain tiles still match the default/FoW reference after the clean background has been installed.

Exercise marker placement and a journey crossing multiple cells, then reload to verify the map and progress persist. For square and pointy-top maps, explicitly check both axes and alternating rows/columns. Deliver the portable mod, editable sources, calibrated metadata, and concise validation/remaining-uncertainty notes. Do not upload, publish, or change the user’s current expedition unless requested.
