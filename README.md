# Soudache 3D QC Viewer

Public, read-only 3D QC surface for Soudache assets that are explicitly licensed for public display.

The private `Zuozzzzzzzz/soudache-content` repository remains the sole production source of truth. This repository contains only the viewer, a minimal traceability registry, integrity-checked deployment automation, and a generated GitHub Pages artifact. It does not contain production ledgers, handoffs, pipeline records, credentials, or tracked copies of the formal GLBs.

## Viewer

- Runtime: Google `<model-viewer>` 4.1.0
- Controls: orbit, zoom, pan, reset, auto-frame, front/side/back presets
- Rendering: neutral environment and tone mapping; no presentation lighting or asset edits
- Registry: 13 approved Batch 01 assets (6 DIRECT, 7 RETEXTURE)
- Source commit: `176588265b8a170d54910e9686d35a65bef3c10a`

## Delivery integrity

GitHub Actions downloads the immutable `asset-bundle-v1` QC release, verifies the bundle SHA-256, then checks every GLB against the exact byte count and SHA-256 recorded in `asset-sources.json`. It validates each GLB 2 header and structure before placing the files in the ephemeral Pages artifact. A mismatch blocks deployment.

No Meshy generation or paid API operation is performed. Credits used: **0**.
