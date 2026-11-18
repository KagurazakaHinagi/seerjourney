#!/usr/bin/env python3
"""Build bounded JPEG tile pyramids from the campaign's existing rasters.

Requires Pillow. Run from any directory with a Python that provides it:
    python tools/prepare_campaign_tiles.py --map-directory /path/to/external-map

The mod uses logical map coordinates that can differ from image pixel sizes.
Manifest width/height retain those coordinates; each level records its actual
pixel dimensions. Tile origins advance by tileSize pixels. Each tile includes
one extra pixel on its right and bottom edge, unless it touches the image edge,
so fractional CSS/SVG scaling cannot expose hairline seams. Divide level pixel
positions by level.width/height and multiply by manifest.width/height to place
them on the map. Layer paths are relative to the manifest's directory.

No labels, geography, fog, or full-size source files are modified. Generated
tiles live with the external map. Stage them for deployment; Vercel's Node
build does not require Python. Do not commit private map assets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

TILE_SIZE = 512
OVERLAP = 1
DIVISORS = (16, 8, 4, 2, 1)


def generate(directory: Path) -> dict:
    config = json.loads((directory / "map.json").read_text())
    output = directory / "tiles"
    output.mkdir(parents=True, exist_ok=True)
    sources = {"background": directory / config["assets"][config["background"]],
               "fog": directory / config["assets"][config["fog"]["image"]]}
    with Image.open(sources["background"]) as source:
        source_width, source_height = source.size
    levels = [
        {"id": str(index), "width": math.ceil(source_width / divisor),
         "height": math.ceil(source_height / divisor)}
        for index, divisor in enumerate(DIVISORS)
    ]
    for level in levels:
        level.update(columns=math.ceil(level["width"] / TILE_SIZE),
                     rows=math.ceil(level["height"] / TILE_SIZE))
    manifest = {
        "version": 1, "mapId": config["id"],
        "width": config["width"], "height": config["height"],
        "sourceWidth": source_width, "sourceHeight": source_height,
        "tileSize": TILE_SIZE, "overlap": OVERLAP,
        "format": "jpeg", "quality": 90,
        "layers": {name: f"{name}/{{id}}/{{column}}-{{row}}.jpg" for name in sources},
        "sourceSha256": {name: hashlib.sha256(file.read_bytes()).hexdigest()
                         for name, file in sources.items()},
        "levels": levels,
    }
    count = byte_count = 0
    for name, filename in sources.items():
        with Image.open(filename) as source:
            if source.size != (source_width, source_height):
                raise ValueError("Background and fog raster dimensions must match")
            source = source.convert("RGB")
            for level in levels:
                size = (level["width"], level["height"])
                raster = source if source.size == size else source.resize(size, Image.Resampling.LANCZOS)
                target = output / name / level["id"]
                target.mkdir(parents=True, exist_ok=True)
                for row in range(level["rows"]):
                    for column in range(level["columns"]):
                        x, y = column * TILE_SIZE, row * TILE_SIZE
                        box = (x, y, min(x + TILE_SIZE + OVERLAP, size[0]),
                               min(y + TILE_SIZE + OVERLAP, size[1]))
                        tile = target / f"{column}-{row}.jpg"
                        raster.crop(box).save(tile, "JPEG", quality=90, subsampling=0, optimize=True)
                        count += 1
                        byte_count += tile.stat().st_size
                if raster is not source:
                    raster.close()
            source.close()
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Generated {count} tiles ({byte_count / 1024 / 1024:.2f} MiB) from "
          f"{source_width}×{source_height} rasters; logical map "
          f"{config['width']}×{config['height']}.")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--map-directory", type=Path, required=True)
    args = parser.parse_args()
    generate(args.map_directory)
