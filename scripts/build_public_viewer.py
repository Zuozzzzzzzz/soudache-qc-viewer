#!/usr/bin/env python3
"""Build a verified, public GitHub Pages artifact without private-repo credentials."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STATIC_FILES = ("index.html", "styles.css", "app.js")


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def inspect_glb(path: Path) -> dict[str, int]:
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise RuntimeError(f"Truncated GLB header: {path}")
        magic, version, declared_length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2:
            raise RuntimeError(f"Invalid GLB 2 header: {path}")
        actual_length = path.stat().st_size
        if declared_length != actual_length:
            raise RuntimeError(f"GLB length mismatch: {declared_length} != {actual_length}")
        chunk_header = stream.read(8)
        if len(chunk_header) != 8:
            raise RuntimeError(f"Missing GLB JSON chunk: {path}")
        json_length, chunk_type = struct.unpack("<I4s", chunk_header)
        if chunk_type != b"JSON":
            raise RuntimeError(f"First GLB chunk is not JSON: {path}")
        document = json.loads(stream.read(json_length).decode("utf-8").rstrip(" \t\r\n\x00"))
    result = {
        "glbVersion": version,
        "meshCount": len(document.get("meshes", [])),
        "materialCount": len(document.get("materials", [])),
        "imageCount": len(document.get("images", [])),
    }
    if result["meshCount"] < 1:
        raise RuntimeError(f"GLB contains no meshes: {path}")
    return result


def safe_output(path: Path) -> Path:
    resolved = path.resolve()
    if resolved == ROOT or ROOT not in resolved.parents:
        raise RuntimeError("Output must be a dedicated directory inside the checkout")
    return resolved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--asset-dir", required=True, type=Path)
    args = parser.parse_args()
    output = safe_output(args.output)
    asset_dir = args.asset_dir.resolve()
    if not asset_dir.is_dir():
        raise RuntimeError(f"Verified asset input directory is missing: {asset_dir}")
    if output.exists():
        shutil.rmtree(output)
    (output / "assets").mkdir(parents=True)

    payload = json.loads((ROOT / "asset-sources.json").read_text(encoding="utf-8"))
    assets = payload["assets"]
    if len(assets) != 13 or len({asset["assetId"] for asset in assets}) != 13:
        raise RuntimeError("Registry must contain exactly 13 unique assets")
    if sum(asset["route"] == "RETEXTURE" for asset in assets) != 7:
        raise RuntimeError("Registry must contain exactly seven RETEXTURE assets")
    if sum(asset["route"] == "DIRECT" for asset in assets) != 6:
        raise RuntimeError("Registry must contain exactly six DIRECT assets")
    if any(not asset["license"].startswith("CC0") for asset in assets):
        raise RuntimeError("Every public Viewer asset must carry an explicit CC0 license record")

    runtime_assets = []
    total_bytes = 0
    for asset in assets:
        source = asset_dir / f"{asset['assetId']}.glb"
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = output / "assets" / f"{asset['assetId']}.glb"
        print(f"Staging existing {asset['route']} object for {asset['assetId']}", flush=True)
        shutil.copy2(source, destination)
        actual_bytes = destination.stat().st_size
        if actual_bytes != asset["expectedBytes"]:
            raise RuntimeError(f"Unexpected size for {asset['assetId']}: {actual_bytes}")
        actual_sha = digest(destination)
        if actual_sha != asset["expectedSha256"]:
            raise RuntimeError(f"SHA-256 mismatch for {asset['assetId']}: {actual_sha}")
        structure = inspect_glb(destination)
        if asset["route"] == "RETEXTURE" and structure["materialCount"] < 1:
            raise RuntimeError(f"Retextured GLB has no materials: {asset['assetId']}")
        runtime_assets.append({
            **asset,
            **structure,
            "sourceRepository": payload["sourceRepository"],
            "sourceCommit": payload["sourceCommit"],
            "actualBytes": actual_bytes,
            "actualSha256": actual_sha,
            "modelUrl": f"assets/{asset['assetId']}.glb",
            "delivery": "Integrity-verified GitHub Pages artifact; production source remains private",
        })
        total_bytes += actual_bytes

    for filename in STATIC_FILES:
        shutil.copy2(ROOT / filename, output / filename)
    (output / ".nojekyll").write_text("", encoding="utf-8")
    runtime_registry = {
        "schemaVersion": payload["schemaVersion"],
        "viewerName": payload["viewerName"],
        "sourceRepository": payload["sourceRepository"],
        "sourceCommit": payload["sourceCommit"],
        "assetCount": len(runtime_assets),
        "retextureCount": 7,
        "directCount": 6,
        "totalAssetBytes": total_bytes,
        "assets": runtime_assets,
    }
    (output / "asset-registry.json").write_text(
        json.dumps(runtime_registry, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    report = {
        "status": "SUCCESS",
        "assetCount": 13,
        "retextureCount": 7,
        "directCount": 6,
        "totalAssetBytes": total_bytes,
        "sourceCommit": payload["sourceCommit"],
        "credits": 0,
        "meshyGenerationCalled": False,
        "assets": [
            {
                "assetId": asset["assetId"],
                "route": asset["route"],
                "bytes": asset["actualBytes"],
                "sha256": asset["actualSha256"],
                "meshCount": asset["meshCount"],
                "materialCount": asset["materialCount"],
                "imageCount": asset["imageCount"],
                "status": "VERIFIED_AND_STAGED",
            }
            for asset in runtime_assets
        ],
    }
    (output / "build-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
