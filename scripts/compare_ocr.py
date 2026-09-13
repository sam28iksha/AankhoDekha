#!/usr/bin/env python3
"""
NAGARNETRA — PaddleOCR vs EasyOCR standalone comparison
=========================================================
Detects plates in a real camera video using whatever model is CURRENTLY at
models/best.pt (no code changes needed when you swap in a new checkpoint),
crops each detection, runs it through BOTH PaddleOCR and EasyOCR with
identical preprocessing, and writes a side-by-side report (crop image +
both engines' reads + confidence + whether each passes NAGARNETRA's actual
plate-format validation) for manual comparison.

This is a standalone diagnostic — it does not touch ocr.py, the live app,
requirements.txt, or the Docker image. EasyOCR is installed on the fly into
the running container (uninstalled again when the container is recreated).

Usage (inside the backend container):
  docker compose exec backend python scripts/compare_ocr.py --camera cam_04
  docker compose exec backend python scripts/compare_ocr.py --video /app/data/sample_videos/cam_06.mp4 --max-detections 15
"""
from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
from pathlib import Path

# Path resolution — two-runtime design (matches scripts/list_detected_plates.py):
#   Local: inserts NAGARNETRA/backend/ so backend modules resolve.
#   Docker: PYTHONPATH=/app (docker-compose.yml) handles it; insert is a no-op.
_backend_path = Path(__file__).parent.parent / "backend"
if _backend_path.exists():
    sys.path.insert(0, str(_backend_path))

import cv2

# ── Self-install EasyOCR if missing — keeps requirements.txt/Docker image untouched ──
try:
    import easyocr
except ImportError:
    print("EasyOCR not installed — installing now (one-time, this container only)...")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "easyocr"], check=True)
    import easyocr

from paddleocr import PaddleOCR

from anpr.frame_source import VideoFileSource
from anpr.detector import plate_detector
from anpr.ocr import (
    _preprocess_crop, _normalize_plate, _validate_plate,
    _correct_plate_confusions, _correct_missing_district_zero,
)
from config import settings


def run_paddleocr(ocr: PaddleOCR, image) -> tuple[str, float]:
    """Mirrors the parsing in anpr/ocr.py's PlateOCR.read(), minus validation —
    we want the RAW read here so both engines are compared before any
    NAGARNETRA-specific post-processing is applied."""
    try:
        results = ocr.ocr(image, cls=True)
    except Exception:
        return "", 0.0
    if not results or not results[0]:
        return "", 0.0
    texts, confs = [], []
    for line in results[0]:
        if line and len(line) >= 2:
            text_conf = line[1]
            if isinstance(text_conf, (list, tuple)) and len(text_conf) == 2:
                texts.append(str(text_conf[0]))
                confs.append(float(text_conf[1]))
    if not texts:
        return "", 0.0
    return " ".join(texts), sum(confs) / len(confs)


def run_easyocr(reader: "easyocr.Reader", image_rgb) -> tuple[str, float]:
    try:
        results = reader.readtext(
            image_rgb, detail=1,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        )
    except Exception:
        return "", 0.0
    if not results:
        return "", 0.0
    texts = [r[1] for r in results]
    confs = [float(r[2]) for r in results]
    return " ".join(texts), sum(confs) / len(confs)


async def main(args: argparse.Namespace) -> None:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    video_path = args.video or f"/app/data/sample_videos/{args.camera}.mp4"
    if not Path(video_path).exists():
        print(f"Video not found: {video_path}")
        sys.exit(1)

    print(f"Detector weights: {settings.YOLO_WEIGHTS_PATH}")
    print(f"Video: {video_path}")
    print("Loading PaddleOCR...")
    paddle = PaddleOCR(use_angle_cls=True, lang="en", show_log=False, use_gpu=False)
    print("Loading EasyOCR (downloads its own model weights on first run — needs internet)...")
    easy = easyocr.Reader(["en"], gpu=False)

    source = VideoFileSource(video_path)
    rows: list[dict] = []
    count = 0

    async for frame in source:
        if count >= args.max_detections:
            break
        detections = plate_detector.detect(frame.image, conf_threshold=args.conf_threshold)
        for det in detections:
            if count >= args.max_detections:
                break

            # Identical preprocessing for both engines — isolates the
            # comparison to OCR engine quality, not confounded by different
            # preprocessing per engine.
            preprocessed = _preprocess_crop(det.crop)
            preprocessed_rgb = cv2.cvtColor(preprocessed, cv2.COLOR_BGR2RGB)

            p_text_raw, p_conf = run_paddleocr(paddle, preprocessed)
            e_text_raw, e_conf = run_easyocr(easy, preprocessed_rgb)

            p_norm = _normalize_plate(p_text_raw)
            e_norm = _normalize_plate(e_text_raw)

            # Mirrors what PlateOCR.read() now does in production: only try
            # confusion-correction / missing-zero recovery if the raw
            # normalized read doesn't already validate, and only keep a
            # correction if it does.
            p_final = p_norm
            if p_norm and not _validate_plate(p_final):
                p_corrected = _correct_plate_confusions(p_norm)
                p_zero_corrected = _correct_missing_district_zero(p_norm)
                if p_corrected != p_norm and _validate_plate(p_corrected):
                    p_final = p_corrected
                elif p_zero_corrected != p_norm and _validate_plate(p_zero_corrected):
                    p_final = p_zero_corrected
            p_valid = bool(p_final) and _validate_plate(p_final)
            e_valid = _validate_plate(e_norm)

            crop_path = out_dir / f"{count:03d}.jpg"
            cv2.imwrite(str(crop_path), det.crop)

            rows.append({
                "idx": count,
                "crop_file": crop_path.name,
                "det_conf": round(det.confidence, 3),
                "paddle_text": p_final, "paddle_conf": round(p_conf, 3), "paddle_valid": p_valid,
                "easyocr_text": e_norm, "easyocr_conf": round(e_conf, 3), "easyocr_valid": e_valid,
            })
            count += 1
            print(f"[{count}/{args.max_detections}] Paddle='{p_final}'({p_valid}, raw='{p_norm}')  EasyOCR='{e_norm}'({e_valid})")

    report_path = out_dir / "comparison.md"
    with report_path.open("w") as f:
        f.write("| # | Crop | Det Conf | PaddleOCR | Conf | Valid | EasyOCR | Conf | Valid |\n")
        f.write("|---|------|----------|-----------|------|-------|---------|------|-------|\n")
        for r in rows:
            f.write(
                f"| {r['idx']} | {r['crop_file']} | {r['det_conf']} "
                f"| {r['paddle_text'] or '—'} | {r['paddle_conf']} | {'YES' if r['paddle_valid'] else 'no'} "
                f"| {r['easyocr_text'] or '—'} | {r['easyocr_conf']} | {'YES' if r['easyocr_valid'] else 'no'} |\n"
            )

    paddle_valid_count = sum(1 for r in rows if r["paddle_valid"])
    easy_valid_count = sum(1 for r in rows if r["easyocr_valid"])

    print(f"\nCompared {len(rows)} detections.")
    print(f"PaddleOCR: {paddle_valid_count}/{len(rows)} passed NAGARNETRA's plate-format validation")
    print(f"EasyOCR:   {easy_valid_count}/{len(rows)} passed NAGARNETRA's plate-format validation")
    print(f"\nFull report: {report_path}")
    print(f"Crops saved to: {out_dir}  (open these to manually judge which engine actually read correctly)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compare PaddleOCR vs EasyOCR on real footage")
    parser.add_argument("--camera", default="cam_04", help="Camera ID (uses data/sample_videos/<camera>.mp4)")
    parser.add_argument("--video", default=None, help="Explicit video path override")
    parser.add_argument("--max-detections", type=int, default=20)
    parser.add_argument("--conf-threshold", type=float, default=None, help="Defaults to settings.DETECTION_CONFIDENCE_THRESHOLD")
    parser.add_argument("--out-dir", default="/app/data/ocr_comparison")
    cli_args = parser.parse_args()
    if cli_args.conf_threshold is None:
        cli_args.conf_threshold = settings.DETECTION_CONFIDENCE_THRESHOLD
    asyncio.run(main(cli_args))
