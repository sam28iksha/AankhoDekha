"""
NAGARNETRA — PaddleOCR License Plate Reader
Reads character text from cropped plate images.

Post-processing pipeline:
  1. PaddleOCR raw text
  2. Normalize: uppercase, remove spaces/special chars except alphanumeric
  3. Indian plate format validation (optional warn if format unexpected)
  4. Return (normalized_text, confidence)
"""
from __future__ import annotations

import logging
import re
from typing import Tuple

import numpy as np

from config import settings

logger = logging.getLogger(__name__)

# Indian license plate patterns (common formats):
# Standard: XX 00 XX 0000  (state_code dist_code letters digits)
# BH series: 00 BH 0000 XX
_INDIAN_PLATE_RE = re.compile(
    r"^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$|"  # standard
    r"^\d{2}BH\d{4}[A-Z]{1,2}$",             # BH series
    re.IGNORECASE,
)


def _normalize_plate(raw: str) -> str:
    """Strip non-alphanumeric chars, uppercase, max 12 chars."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    return cleaned[:12]


def _validate_plate(plate: str) -> bool:
    """Return True if plate matches known Indian plate patterns."""
    return bool(_INDIAN_PLATE_RE.match(plate))


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
            plate_text   : normalized plate string (uppercase, no spaces)
            confidence   : average OCR word confidence [0.0, 1.0]
            Returns ("", 0.0) if nothing readable.
        """
        if self._ocr is None:
            self._load()

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

        # Join all fragments (PaddleOCR sometimes splits plate into multiple words)
        raw_text = " ".join(texts)
        normalized = _normalize_plate(raw_text)
        avg_conf = sum(confs) / len(confs)

        if not normalized:
            return "", 0.0

        if not _validate_plate(normalized):
            logger.debug(f"Non-standard plate format: '{normalized}' (raw: '{raw_text}')")

        return normalized, avg_conf


# Singleton instance
plate_ocr = PlateOCR()
