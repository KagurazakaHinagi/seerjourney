# Iconoir icons

Source: [Iconoir](https://iconoir.com/), regular SVG set, release **v7.12.2**.
Pinned upstream commit: `39834e3f193bc0cca2c36bebb6a650471977433d`.

Original files: https://github.com/iconoir-icons/iconoir/tree/39834e3f193bc0cca2c36bebb6a650471977433d/icons/regular

## Interface controls

`ui-icons.json` maps each interface symbol ID (without the `i-` prefix) to its
unmodified upstream SVG. These original paths supply map controls, navigation,
actions, dialog controls, selection checks, and the journey's camping marker.
The `calendar` icon continues to identify the full game log.

Run `node scripts/sync-icons.cjs` after changing the mapping or upstream files
to regenerate the inline symbols in `src/client/index.html`. The build checks that these
definitions match the supplied SVGs and includes their local copies for offline use.

All files use the upstream 24 × 24 viewBox and 1.5px stroke. The UI keeps icon
sizes and button hit targets in CSS, while the source artwork remains unchanged.
`edit-pencil` represents drawing a fog brush stroke; `path-arrow` represents the
journey route; `shopping-bag` represents supplies; `smartphone-device` identifies
Add to Home Screen. Iconoir has no paintbrush icon in this pinned release.

The SeerJourney nautical logo is a separate identity asset, not a library icon.

## Location bookmarks

| Bookmark kind | Original file | Sprite symbol |
| --- | --- | --- |
| Place | `map-pin.svg` | `place` |
| Camp | `bonfire.svg` | `camp` |
| Danger | `warning-triangle.svg` | `danger` |
| Ruin | `tower.svg` | `ruin` |
| Treasure | `coins.svg` | `treasure` |
| Tomb | `tomb.svg` (project-authored) | `tomb` |

The five Iconoir bookmark SVG files are unmodified upstream assets. `markers.svg`
wraps their original child elements in symbols with the same 24 × 24 viewBox,
1.5 stroke width, no fill by default, and `currentColor` strokes. This provides
one aligned icon set for map bookmarks, search results, and the bookmark picker.

Iconoir v7.12.2 has no tomb or gravestone icon. `tomb.svg` is a project-authored
SeerJourney tombstone with a round arch, inscription, and base, drawn on the same
24 × 24 grid with a 1.5px stroke. It is included in the sprite as `tomb` and is
available under the project's Apache License, Version 2.0, copyright (c) 2026
SeerJourney contributors. See the repository's `LICENSE` and `NOTICE`; the
upstream Iconoir MIT license below does not apply to this custom drawing.

The upstream Iconoir assets are licensed under the MIT License. Their full copyright and license notice
are preserved in `LICENSE` and must accompany redistributed copies.
