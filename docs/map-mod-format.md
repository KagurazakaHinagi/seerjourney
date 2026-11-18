# SeerJourney map mods, version 1

This is the shared format reference, including the original standalone app’s import workflow. In this campaign edition, use [deployment staging and unpacking](map-deployment.md); guests do not import or switch maps in the browser.

A map mod is data plus raster images. It supplies the map, grid geometry, discovery rules, and map labels. The application supplies navigation, brushes, annotations, trip logs, sessions, and storage. Importing a mod never executes code.

The portable deliverable is one `NAME.seerjourney-mod.json` file. The version 1 JSON `format` remains `mapjourney-mod` for compatibility, and existing `.mapjourney-mod.json` files remain importable. The filename extension is a naming convention; the schema identifies the file. Every image is embedded as a base64 PNG, JPEG, or WebP data URL. A development manifest may instead use raster paths relative to its own folder; `pack_mod.py` converts it to a portable file. The app’s bundled loader supports those same folder-local paths. The normal import dialog requires embedded images.

## Manifest

```json
{
  "format": "mapjourney-mod",
  "version": 1,
  "revision": 1,
  "id": "my-campaign-map-v1",
  "name": "My campaign map",
  "description": "A map prepared from the supplied campaign artwork.",
  "width": 640,
  "height": 480,
  "grid": {
    "type": "square",
    "originX": 40,
    "originY": 40,
    "radiusX": 40,
    "radiusY": 40,
    "columnStep": 80,
    "rowStep": 80,
    "minColumn": 0,
    "maxColumn": 7,
    "minRow": 0,
    "maxRow": 5,
    "bounds": { "x": 0, "y": 0, "width": 640, "height": 480 }
  },
  "scale": { "distance": 5, "unit": "ft" },
  "background": "terrain",
  "fog": { "cells": ["5,4"], "color": "#e5e8dc" },
  "tags": [
    {
      "id": "hidden-cache",
      "name": "Hidden cache",
      "asset": "cache-label",
      "x": 428,
      "y": 336,
      "width": 100,
      "height": 40,
      "visibility": "revealed",
      "cell": "5,4",
      "anchor": { "x": 440, "y": 360 }
    }
  ],
  "assets": {
    "terrain": "images/terrain.jpg",
    "cache-label": "images/cache-label.png"
  }
}
```

This example is a **development manifest**: replace its image paths with embedded data URLs by packing real files. Its single fog cell is intentional; most maps list all valid cells or the subset that starts undiscovered.

| Field | Meaning |
| --- | --- |
| `version` | Schema version, currently `1`. |
| `revision` | Optional positive safe integer identifying this map’s content revision; defaults to `1`. Independent of the schema version. |
| `id` | Stable map identity, independent of the display name. Use a new ID if cell meanings or coordinates change. |
| `name`, `description` | Human-readable map name and optional description. |
| `width`, `height` | Logical map dimensions. All geometry and tag positions use this coordinate system. Raster resolution may differ. |
| `grid` | Calibrated cell centers, extents, spacing, and interactive bounds. |
| `scale` | Optional distance corresponding to one `rowStep`; defaults to `1 cells`. `distance` must be from `1e-12` through `1e12`, inclusive. Unit is display text, such as `mi`, `km`, or `ft`. |
| `background` | Asset ID of the full map background. |
| `fog.cells` | Unique cell keys that the reveal/refog brush can change. Omitted fog means no revealable cells. |
| `fog.color` | Optional opaque six-digit hex color filling unrevealed cells. The app draws their calibrated cell outlines so the grid stays visible. |
| `fog.image` | Optional full-map asset used as the unrevealed surface. Its logical size is the map size. |
| `tags` | Optional cropped label/icon layers. |
| `assets` | Asset IDs mapped to embedded raster data URLs, or folder-local paths during development. |
| `initialView` | Optional `{centerX, centerY, zoom}`; center in logical map coordinates, zoom relative to the fitted view, greater than zero and at most 20. |
| `legacyIds` | Optional earlier IDs whose existing Chult-format sessions may migrate to this map. Use only when geometry and cell meanings are compatible. |

Map, asset, and tag IDs start with a letter or digit, then contain only letters, digits, dots, underscores, or hyphens, up to 120 characters. Reserved prototype property names are rejected. Names support normal Unicode text.

## Grid geometry

Cell keys use zero-based integer indices as strings: `"column,row"`. Negative indices are supported when the calibrated origin lies inside the map. UI coordinates add one to each index. `originX` and `originY` locate cell `(0,0)`’s **center**, not a corner.

`minColumn`, `maxColumn`, `minRow`, and `maxRow` are inclusive. `bounds` clips interaction and fog to the interior map frame; decorative borders may remain outside it. Include partial boundary cells whose geometric extents intersect the frame. Do not calibrate to a decorative border or to a rescaled preview while leaving unscaled dimensions in metadata.

Square grids:

- `type: "square"`; no offset is applied.
- Center: `x = originX + column × columnStep`, `y = originY + row × rowStep`.
- `columnStep = 2 × radiusX`, `rowStep = 2 × radiusY`.
- The engine permits unequal X/Y radii to accommodate raster stretching; use equal radii for an undistorted square map.

Flat-top hex grids:

- `type: "hex"`, `orientation: "flat-top"`, `offset: "odd-column-down"`.
- Center: `x = originX + column × columnStep`, `y = originY + (row + odd(column)/2) × rowStep`.
- `columnStep = 1.5 × radiusX`, `rowStep = 2 × radiusY`.

Pointy-top hex grids:

- `type: "hex"`, `orientation: "pointy-top"`, `offset: "odd-row-right"`.
- Center: `x = originX + (column + odd(row)/2) × columnStep`, `y = originY + row × rowStep`.
- `columnStep = 2 × radiusX`, `rowStep = 1.5 × radiusY`.

`odd(n)` is 0 for even indices and 1 for odd indices, including negative odd indices. Other offsets are not supported in version 1; shift the origin and index ranges to express the map using the supported offset. The validator allows a 0.5% spacing tolerance, with a 0.02-unit floor, for independently fitted raster measurements. Strongly skewed or perspective grids need image rectification before calibration.

## Tags and fog are independent

**A clean, unlabelled background does not mean terrain starts revealed.** When a supplied default/FoW reference has blank tiles, preserve those tiles as terrain fog and extract its known labels as a separate always-visible layer. Labels already present in the FoW reference stay visible even when their icons lie inside fogged cells. Only extra labels absent from the FoW reference become conditional discoveries; compare labels semantically so moved or restyled copies are not mistaken for new locations.

A tag is a transparent raster crop containing the original label and its icon. Its rectangle is located by `x`, `y`, `width`, and `height`. It may span many cells. Do not clip the label text to its triggering cell.

- `visibility: "always"` places the label over the background even when the surrounding terrain is unrevealed.
- `visibility: "revealed"` requires `cell`. The **whole label** appears exactly when that cell is revealed and disappears when it is refogged.
- Choose the trigger cell from the **location icon**, not the center of the text or the crop rectangle.
- `anchor: {x,y}` records the icon location. When a `cell` is present, the validator checks that the anchor lies inside that cell. Always include anchors for hidden location tags.
- Hidden tags must reference a cell included in `fog.cells`.
- Some geographic labels have no point icon. Give always-visible geographic text no trigger cell; if it must be discoverable, choose and document a deliberate landmark anchor instead of pretending the text center is an icon.

Use **label-only discovery** only when the brief or source state establishes that the terrain starts visible. In that mode, omit `fog.color` and `fog.image` while keeping `fog.cells`. The background terrain stays visible; reveal/refog changes the hidden tags. For **terrain discovery**, supply either a fog image or fog color. A color cover preserves the calibrated cell outlines; a fog image supplies its own printed grid and takes precedence when both are present. Default tags remain separate layers in both cases.

`background` must not already contain secret labels also supplied as hidden tags. If a supplied map has permanent labels baked in and no clean source, explain that limitation and request a clean version or leave those labels always visible; do not claim they can be hidden cleanly.

## Packaging and validation

Run the skill’s standard-library packer:

```sh
python3 skills/seerjourney-mod/scripts/pack_mod.py path/to/map.json --output path/to/campaign.seerjourney-mod.json
```

The packer accepts embedded images or folder-local raster paths, refuses traversal/remote paths and mismatched file signatures, and writes atomically. It does not substitute for geometry or rendered validation.

In a SeerJourney checkout, validate against the current application contract:

```sh
node -e 'const fs=require("node:fs"), M=require("./src/shared/map-mod.js"); const m=M.validate(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))); console.log(m.name, m.fogHexes.length, m.tags.length);' path/to/campaign.seerjourney-mod.json
```

Then import it through the app. The browser decodes every image before installation. Verify startup, reveal/refog, markers, journey routes, per-map saves, and reloading. For hidden tags, reveal a text-only neighboring cell first, then the icon cell, then refog the icon cell. The tag must appear only in the second state.

Current limits: 150 MiB portable file; 25,000 cells in the grid’s rectangular index range; 2,000 tags; 2,004 image assets; 100 million decoded pixels per raster; logical dimensions at most 100,000 each. Practical mobile maps should use much smaller images. PNG alpha is preferred for tags; JPEG or WebP usually suits terrain. The app stores large map packages in IndexedDB separately from session progress.

Increment `revision` for compatible content corrections such as restored fog or corrected label extraction, while keeping the same `id` and cell meanings. The number identifies content; it does not promise automatic installation or updating. Distribute the revised portable package for import through the app’s supported workflow.

A mod does not contain session progress. Portable sessions refer to a map ID; keep the matching mod available when moving an expedition to another device. Renaming a map does not require changing its ID. Reassigning cells does.
