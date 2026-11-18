#!/usr/bin/env python3
"""Embed folder-local raster assets in a portable SeerJourney mod (stdlib only)."""
from __future__ import annotations
import argparse
import base64
import json
from pathlib import Path
import re
import tempfile

MAX_BYTES = 150 * 1024 * 1024
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\Z")
PATH = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_./-]*\.(?:png|jpe?g|webp)\Z", re.I)
DATA = re.compile(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})\Z")
RESERVED = {"__proto__", "constructor", "prototype"}


def check_signature(data: bytes, kind: str, name: str) -> None:
    good = {
        "png": len(data) >= 24 and data.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpeg": len(data) >= 4 and data.startswith(b"\xff\xd8\xff"),
        "webp": len(data) >= 16 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
    }.get(kind, False)
    if not good:
        raise ValueError(f"{name}: raster bytes do not match image/{kind}")


def embedded(value: str, root: Path, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name}: expected a local raster path or embedded data URL")
    if value.startswith("data:"):
        match = DATA.fullmatch(value)
        if not match:
            raise ValueError(f"{name}: only base64 PNG, JPEG, or WebP images are supported")
        kind, encoded = match.groups()
        data = base64.b64decode(encoded, validate=True)
        check_signature(data, kind, name)
        return value
    if not PATH.fullmatch(value) or any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError(f"{name}: image paths must stay inside the manifest folder")
    source = (root / value).resolve()
    if not source.is_relative_to(root):
        raise ValueError(f"{name}: symlinks cannot escape the manifest folder")
    if not source.is_file() or source.stat().st_size > MAX_BYTES:
        raise ValueError(f"{name}: raster is missing or exceeds 150 MiB")
    data = source.read_bytes()
    kind = source.suffix.lower().lstrip(".")
    if kind == "jpg":
        kind = "jpeg"
    check_signature(data, kind, name)
    return f"data:image/{kind};base64," + base64.b64encode(data).decode("ascii")


def pack(manifest: Path, output: Path) -> dict:
    manifest = manifest.resolve()
    if manifest.stat().st_size > MAX_BYTES:
        raise ValueError("Manifest exceeds 150 MiB")
    raw = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("format") != "mapjourney-mod" or raw.get("version") != 1:
        raise ValueError("Expected a version 1 mapjourney-mod manifest")
    revision = raw.get("revision", 1)
    if type(revision) is not int or not 1 <= revision <= 9007199254740991:
        raise ValueError("Map revision must be a positive safe integer")
    raw["revision"] = revision
    if not isinstance(raw.get("id"), str) or not ID.fullmatch(raw["id"]) or raw["id"] in RESERVED:
        raise ValueError("Map ID must be a stable identifier using letters, digits, dots, underscores, or hyphens")
    assets = raw.get("assets")
    if not isinstance(assets, dict) or not 1 <= len(assets) <= 2004:
        raise ValueError("Manifest must contain between 1 and 2,004 raster assets")
    packed, total = {}, 0
    for name, value in assets.items():
        if not ID.fullmatch(name) or name in RESERVED:
            raise ValueError(f"Invalid asset ID: {name}")
        packed[name] = embedded(value, manifest.parent, name)
        total += len(packed[name])
        if total > MAX_BYTES:
            raise ValueError("Embedded images exceed the 150 MiB package limit")
    raw["assets"] = packed
    payload = (json.dumps(raw, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    if len(payload) > MAX_BYTES:
        raise ValueError("Portable package exceeds 150 MiB; reduce raster resolution or compression size")
    output = output.resolve()
    if output == manifest:
        raise ValueError("Choose a separate output file to preserve the editable source manifest")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=f".{output.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
        temporary.replace(output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return {"id": raw["id"], "assets": len(packed), "bytes": len(payload), "output": str(output)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = pack(args.manifest, args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Cannot pack map mod: {error}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
