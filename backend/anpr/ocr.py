"""
NAGARNETRA — PaddleOCR License Plate Reader
Reads character text from cropped plate images.

Post-processing pipeline:
  1. PaddleOCR raw text
  2. Normalize: uppercase, strip all non-alphanumeric chars
  3. Indian plate format validation — REJECT strings that don't match
  4. Return (normalized_text, confidence) or ("", 0.0) if invalid

Accepted formats
----------------
  Standard  : XX00X{1-3}0000   e.g. MH01AB1234, DL01AB2345 (2-digit district,
              1-3 letter series, 4-digit number — the near-universal modern
              format; a fragment like "CH01CX747" or "PB65770" is rejected
              rather than silently accepted as some other, wrong, plate)
  BH series : 00BH0000XX       e.g. 22BH1234AB

Both formats additionally require the 2-letter state/UT code to be one of
the real Indian RTO codes (_VALID_STATE_CODES below) — this catches reads
like "CX7427" or "OL7SCD6547" that are structurally plate-shaped but use a
state code that doesn't exist, which is a strong signal of a truncated or
garbled OCR read rather than a real plate the format regex should let through.
"""
from __future__ import annotations

import logging
import re
from typing import Tuple

import cv2
import numpy as np

from config import settings

logger = logging.getLogger(__name__)


def _preprocess_crop(crop: np.ndarray) -> np.ndarray:
    """
    Enhance a plate crop before OCR — no retraining needed, targets the exact
    failure modes seen in real traffic footage:
      - Upscale small crops (character strokes too thin for OCR to resolve)
      - Mild unsharp-mask sharpening (counteracts motion blur)

    Deliberately NOT doing CLAHE here: tested against real footage it
    actively broke marginal-but-correct reads (verified case: a plate that
    read fine on the raw crop returned nothing after CLAHE). Indian plates
    already have strong inherent contrast (dark text on a light/yellow
    background), so CLAHE's local-contrast boost mostly amplifies noise
    rather than helping — it's solving a problem this input doesn't have.
    """
    if crop.size == 0:
        return crop

    h, w = crop.shape[:2]
    target_h = 64
    if h < target_h:
        scale = target_h / h
        crop = cv2.resize(crop, (max(1, int(w * scale)), target_h), interpolation=cv2.INTER_CUBIC)

    blurred = cv2.GaussianBlur(crop, (0, 0), sigmaX=3)
    crop = cv2.addWeighted(crop, 1.5, blurred, -0.5, 0)

    return crop

# ── Indian licence plate patterns ──────────────────────────────────────────
# Standard: <state 2L><district 2D><series 1-3L><number 4D>
#   Covers:  DL01AB1234  MH10Z0499  KA09MF2546
# BH series: <year 2D>BH<number 4D><class 1-2L>  e.g. 22BH1234AB
_STANDARD_PLATE_RE = re.compile(r"^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{4})$")
_BH_PLATE_RE = re.compile(r"^\d{2}BH\d{4}[A-Z]{1,2}$")

# Real Indian state / union-territory RTO codes. A plate whose prefix isn't
# in this set cannot be a genuine Indian plate no matter how well it otherwise
# matches the format — this is what actually filters out near-miss OCR noise
# like "CX7427" (no such state as "CX").
_VALID_STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "DN", "GA", "GJ",
    "HR", "HP", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP",
    "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TS", "TR", "UP",
    "UK", "UA", "WB",
}

# Plates shorter than this are fragments, not real plates
_MIN_PLATE_LEN = 6
# ───────────────────────────────────────────────────────────────────────────


def _normalize_plate(raw: str) -> str:
    """Strip non-alphanumeric chars, uppercase, cap at 12 chars."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    return cleaned[:12]


def _validate_plate(plate: str) -> bool:
    """
    Return True only if the string is a strict-format Indian plate with a
    real state/UT code — both conditions must hold, not just format shape.

    This is the hard gate: strings like 'GOODSCARRIER', 'PRIVATE', 'CX7427'
    (fake state code), or 'CH01CX747' (wrong digit count — a truncated read)
    will all fail and be discarded rather than stored as a wrong plate.
    """
    if len(plate) < _MIN_PLATE_LEN:
        return False

    if _BH_PLATE_RE.match(plate):
        return True

    m = _STANDARD_PLATE_RE.match(plate)
    if not m:
        return False

    state_code = m.group(1)
    return state_code in _VALID_STATE_CODES


class PlateOCR:
    """
    PaddleOCR wrapper for license plate character recognition.
    Lazy-initialized to avoid startup delay.
    """

    def __init__(self):
        self._ocr = None

    def _load(self):
        from paddleocr import PaddleOCR
        self._ocr = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            show_log=False,
            use_gpu=False,
        )
        logger.info("PaddleOCR reader ready.")

    def read(self, crop: np.ndarray) -> Tuple[str, float]:
        """
        Run OCR on a cropped plate image.

        Returns
        -------
        (plate_text, confidence)
            plate_text   : normalized plate string, or "" if OCR result
                           fails the Indian plate format validation.
            confidence   : average OCR word confidence [0.0, 1.0]
        """
        if self._ocr is None:
            self._load()

        crop = _preprocess_crop(crop)

        try:
            results = self._ocr.ocr(crop, cls=True)
        except Exception as e:
            logger.warning(f"PaddleOCR error: {e}")
            return "", 0.0

        if not results or not results[0]:
            return "", 0.0

        # Collect all recognized text segments and their confidences
        texts = []
        confs = []
        for line in results[0]:
            if line and len(line) >= 2:
                text_conf = line[1]
                if isinstance(text_conf, (list, tuple)) and len(text_conf) == 2:
                    texts.append(str(text_conf[0]))
                    confs.append(float(text_conf[1]))

        if not texts:
            return "", 0.0

        # Join all fragments (PaddleOCR sometimes splits a plate across words)
        raw_text = " ".join(texts)
        normalized = _normalize_plate(raw_text)
        avg_conf = sum(confs) / len(confs)

        if not normalized:
            return "", 0.0

        # ── Hard gate: reject anything that isn't a valid Indian plate ──────
        if not _validate_plate(normalized):
            logger.info(
                f"OCR rejected (non-plate text): '{normalized}' "
                f"(raw: '{raw_text}', conf: {avg_conf:.2f})"
            )
            return "", 0.0
        # ────────────────────────────────────────────────────────────────────

        return normalized, avg_conf


# Singleton instance
plate_ocr = PlateOCR()
