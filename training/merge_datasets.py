"""
AANKHODEKHA — Merge multiple small Roboflow YOLOv8 plate datasets into one.

Run this in Colab, in a cell, after unzipping each dataset to its own folder
(e.g. /content/ds1, /content/ds2, ...). Each dataset must be a standard
Roboflow "YOLOv8" export: train/images, train/labels, valid/images,
valid/labels, data.yaml. If a dataset has extra classes beyond the license
plate itself, those boxes are dropped (with a warning) rather than silently
mis-mapped into the plate class.

Usage (edit DATASET_DIRS, then run):
    DATASET_DIRS = ["/content/ds1", "/content/ds2", "/content/ds3"]
    OUTPUT_DIR   = "/content/combined_dataset"
    python merge_datasets.py     # or just paste the body into a Colab cell
"""
from __future__ import annotations

import shutil
from pathlib import Path

try:
    import yaml
except ImportError:
    import subprocess, sys
    subprocess.run([sys.executable, "-m", "pip", "install", "pyyaml", "-q"])
    import yaml

# ── EDIT THESE ────────────────────────────────────────────────────────────
DATASET_DIRS = [
    "/content/ds1",
    "/content/ds2",
    "/content/ds3",
]
OUTPUT_DIR = "/content/combined_dataset"
# Names (case-insensitive substring match) that count as "license plate" —
# add to this list if one of your datasets uses an unusual class name.
PLATE_NAME_HINTS = ["plate", "license", "number_plate", "numberplate", "np"]
# ────────────────────────────────────────────────────────────────────────


def _is_plate_class(name: str) -> bool:
    name = name.lower()
    return any(hint in name for hint in PLATE_NAME_HINTS)


def _remap_label_file(src_label: Path, dst_label: Path, class_map: dict[int, int]) -> bool:
    """Rewrite a YOLO label file keeping only plate-class boxes, remapped to class 0."""
    if not src_label.exists():
        dst_label.write_text("")
        return True
    lines_out = []
    for line in src_label.read_text().splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        cls_idx = int(parts[0])
        if cls_idx in class_map:
            lines_out.append(" ".join(["0"] + parts[1:]))
    dst_label.write_text("\n".join(lines_out) + ("\n" if lines_out else ""))
    return True


def merge(dataset_dirs: list[str], output_dir: str) -> None:
    out = Path(output_dir)
    for split in ("train", "valid"):
        (out / split / "images").mkdir(parents=True, exist_ok=True)
        (out / split / "labels").mkdir(parents=True, exist_ok=True)

    total_images = {"train": 0, "valid": 0}

    for ds_i, ds_dir in enumerate(dataset_dirs):
        ds_path = Path(ds_dir)
        yaml_path = ds_path / "data.yaml"
        if not yaml_path.exists():
            print(f"⚠️  Skipping {ds_dir} — no data.yaml found (not a YOLOv8 export?)")
            continue

        meta = yaml.safe_load(yaml_path.read_text())
        names = meta.get("names", [])
        if isinstance(names, dict):  # some exports use {0: 'plate'} instead of a list
            names = [names[k] for k in sorted(names)]

        class_map = {i: 0 for i, n in enumerate(names) if _is_plate_class(n)}
        dropped = [n for i, n in enumerate(names) if i not in class_map]
        if dropped:
            print(f"ℹ️  {ds_dir}: keeping plate class(es) only, dropping {dropped}")
        if not class_map:
            print(f"⚠️  {ds_dir}: no class matched plate-name hints ({names}) — check PLATE_NAME_HINTS")
            continue

        for split_variant in ("train", "valid", "val"):
            split_dir = ds_path / split_variant
            img_dir = split_dir / "images"
            lbl_dir = split_dir / "labels"
            if not img_dir.exists():
                continue
            split = "valid" if split_variant in ("valid", "val") else "train"

            for img_path in img_dir.iterdir():
                if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                    continue
                prefix = f"ds{ds_i}_"
                dst_img = out / split / "images" / (prefix + img_path.name)
                shutil.copy(img_path, dst_img)

                src_label = lbl_dir / (img_path.stem + ".txt")
                dst_label = out / split / "labels" / (prefix + img_path.stem + ".txt")
                _remap_label_file(src_label, dst_label, class_map)
                total_images[split] += 1

    (out / "data.yaml").write_text(
        f"train: {out}/train/images\n"
        f"val: {out}/valid/images\n"
        f"nc: 1\n"
        f"names: ['license_plate']\n"
    )

    print(f"\n✅ Combined dataset written to {out}")
    print(f"   train images: {total_images['train']}")
    print(f"   valid images: {total_images['valid']}")
    print(f"   data.yaml: {out}/data.yaml")


if __name__ == "__main__":
    merge(DATASET_DIRS, OUTPUT_DIR)
