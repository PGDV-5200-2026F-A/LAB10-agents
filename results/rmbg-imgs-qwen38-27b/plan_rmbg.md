<!-- plan model: qwen3.8:27b -->
# Plan: Remove backgrounds from all images in `imgs/`

## Context

The user wants background removal (transparent cutouts) for all images in `imgs/`. The directory contains 6 JPEGs:

- `spoon00.jpg`, `spoon01.jpg`, `spoon02.jpg` (~100–130 KB each)
- `tag00.jpg`, `tag01.jpg`, `tag02.jpg` (~170–218 KB each)

The `rmbg` skill (`.claude/skills/rmbg/SKILL.md`) provides a local, offline, no-API-key way to do this with the `rembg` U²-Net model via `uvx`. It supports folder batch mode, which is exactly what we need.

## Approach

Use the skill's **folder batch command** to process all 6 images in one shot, writing transparent PNGs to a new directory so the originals are never touched (per the skill's rule: never overwrite originals).

### Step 1 — Batch process

```bash
cd /content/LAB09-agents
uvx --python 3.11 --with "numba>=0.59.1" --from "rembg[cpu,cli]" rembg p imgs/ imgs_nobg/
```

- Output: `imgs_nobg/{spoon00,spoon01,spoon02,tag00,tag01,tag02}.png` — same basenames as the inputs, PNG with alpha channel, original dimensions preserved.
- **First run only:** rembg downloads the u2net model (~176 MB) to `~/.u2net/`; subsequent runs are offline and fast. This one-time network fetch is expected and is the only network activity.
- The `--python 3.11 --with "numba>=0.59.1"` pins are required — do not simplify the command; the skill documents why it fails without them.

### Step 2 — Verify each output

For each of the 6 PNGs, confirm:
1. The file exists and is non-empty.
2. It opens as mode `RGBA`.
3. It contains **both** fully transparent and fully opaque pixels (proves the cutout actually knocked something out).

Quick check (Pillow via uvx, per the skill's on-demand pattern):

```bash
uvx --python 3.11 --with pillow python -c "
from PIL import Image
import glob
for f in sorted(glob.glob('imgs_nobg/*.png')):
    im = Image.open(f)
    al = im.getchannel('A')
    hist = al.histogram()
    print(f, im.size, im.mode, 'transparent:', hist[0], 'opaque:', hist[255])
"
```

### Step 3 — Quality check / fallbacks

- If a cutout has rough edges or a halo (possible on these product-style JPEGs), re-run that single image with alpha matting and a stronger model:
  ```bash
  uvx --python 3.11 --with "numba>=0.59.1" --from "rembg[cpu,cli]" rembg i -m isnet-general-use -a imgs/<name>.jpg imgs_nobg/<name>.png
  ```
- If the background is a known solid color and rembg leaves a halo, apply the skill's color-keying "Fix A" script to that image.
- Only escalate per-image if the default batch output looks wrong — no reason to pre-empt it.

## What is NOT done

- Originals in `imgs/` are left untouched.
- No JPEG output (can't hold transparency).
- No external/uploaded service — everything runs locally.

## Result to report

The 6 cutout paths in `imgs_nobg/`, with size and alpha confirmation from the verification step.
