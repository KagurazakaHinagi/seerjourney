# Loading a map for deployment

A deployment has one selected map. The source repository contains only the original `examples/demo-map/`; supply other artwork outside Git. Map preparation and campaign saves are separate operations.

## Editable map folder

An editable mod contains `map.json` and the PNG, JPEG, or WebP files referenced by its `assets` table. Paths must stay inside the folder. Grid geometry may be square, flat-top hex, or pointy-top hex; see [the format reference](map-mod-format.md).

```sh
npm run map:stage -- /absolute/path/to/my-map
npm run build
```

Staging validates and normalizes metadata, copies referenced raster files, and includes a valid optional `tiles/manifest.json` and its tile files. It rejects traversal paths, symlinks, missing assets, mismatched map geometry, and stale tile source hashes. Unknown files in the mod folder are not uploaded. The canonical folder is never modified.

The stage is `.campaign-map/`, ignored by Git and included by the Vercel CLI. It can be regenerated at any time from the original. `dist/campaign-map/` is the generated web output. Do not commit either directory. On Vercel only the manifest metadata is included in API function bundles; artwork is static output.

## Portable mod file

If you have only a `.seerjourney-mod.json` (or legacy `.mapjourney-mod.json`) with embedded raster images, unpack it to a **new external directory**:

```sh
npm run map:unpack -- /absolute/path/to/map.seerjourney-mod.json /absolute/path/to/my-map
npm run map:stage -- /absolute/path/to/my-map
npm run build
```

Unpacking validates the package before writing, preserves its ID and coordinate system, and refuses to overwrite an existing destination. Portable mods do not carry the deployment tile pyramid; generate one separately for large rasters. Unpacking does not download images or execute map-provided code.

To create a portable file from an editable folder:

```sh
python3 skills/seerjourney-mod/scripts/pack_mod.py /absolute/path/to/my-map/map.json --output /absolute/path/to/map.seerjourney-mod.json
```

The packer needs only the Python standard library. The [map preparation skill](../skills/seerjourney-mod/SKILL.md) describes calibration and separating original fog, terrain, and label layers.

## Which map is used?

The build/server selects, in order:

1. `CAMPAIGN_MAP_DIR` when explicitly configured;
2. `.campaign-map/` when present;
3. the redistributable demo, unless `CAMPAIGN_MAP_REQUIRED=1` forbids fallback.

An invalid configured or staged map is an error. It never silently falls through to the demo. Local `npm run dev` and `npm run build` read `.env`. Tests explicitly select synthetic fixtures. A developer-machine absolute path cannot work on Vercel; there use staging plus `CAMPAIGN_MAP_REQUIRED=1`, with no `CAMPAIGN_MAP_DIR` setting.

A stale explicit `CAMPAIGN_MAP_DIR` takes precedence over a newly staged folder. Update or remove the variable before switching maps. For a different map, use a new campaign namespace/data file rather than trying to reinterpret old cell coordinates. Map ID mismatches are rejected without replacing stored progress.

## Tile generation for mobile performance

Maps without a tile pyramid use their full raster backgrounds. That is convenient for small maps but can consume significant decoded memory on phones. To generate bounded JPEG tiles, install Pillow in your own Python environment and run:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install Pillow
.venv/bin/python tools/prepare_campaign_tiles.py --map-directory /absolute/path/to/my-map
npm run map:stage -- /absolute/path/to/my-map
```

The tool requires matching-size background and fog images. It writes the pyramid into the **external map folder**, leaving source rasters intact. For color-only fog, omit the pyramid or supply a compatible fog raster first. Five resolutions, 512-pixel tiles, and a one-pixel edge overlap let the browser load the overview and only nearby detail. The manifest records source hashes; regenerate tiles whenever either source raster changes.

Keep map tiles with the external editable source, not Git. Vercel does not need Python when deploying pre-generated tiles. The original demo includes its redistributable pre-generated assets and a source generator.

## Updating an established campaign

Compatible artwork/fog corrections retain the same map ID, logical dimensions, and cell meanings; increment the mod revision. Re-stage and redeploy after changes. Existing saved discoveries and routes continue to refer to the same cells. A change in grid meaning should use a new map ID and separate campaign state.

A session backup contains progress, notes, and attachment references, not map artwork. Load session does not select a map. Keep the matching external mod available when restoring a campaign.

## Distribution boundary

The Apache-2.0 application license does not grant rights to externally supplied maps. Keep source artwork, diagnostic crops, portable archives, and any map-specific notices with the external mod. This project does not bundle or audit those external maps.

Serving a map necessarily sends its images and labels to viewers. Exclusion from GitHub does not prevent visitors from downloading deployed assets, including the revealed terrain behind gameplay fog. Choose map material and hosting permissions accordingly. This app does not provide server-side secret-map rendering.
