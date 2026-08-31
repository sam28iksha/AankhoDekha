"""
NAGARNETRA — Frame Source Abstraction
All video/stream sources implement FrameSource so the pipeline is source-agnostic.
To add a live RTSP stream, subclass FrameSource and override __aiter__.
"""
from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import AsyncIterator, NamedTuple

import cv2
import numpy as np

from config import settings

logger = logging.getLogger(__name__)


class Frame(NamedTuple):
    """A single video frame with metadata."""
    image: np.ndarray       # BGR image (OpenCV format)
    frame_index: int        # sequential frame number
    timestamp_ms: float     # milliseconds from start of video


class FrameSource(ABC):
    """Abstract base class for all frame sources (file, RTSP, webcam, etc.)."""

    @abstractmethod
    async def __aiter__(self) -> AsyncIterator[Frame]:
        ...

    @property
    @abstractmethod
    def fps(self) -> float:
        ...

    @property
    @abstractmethod
    def total_frames(self) -> int:
        ...


class VideoFileSource(FrameSource):
    """
    Reads frames from a local video file, yielding every Nth frame.

    Parameters
    ----------
    path       : Path to the video file (e.g. cam_01.mp4)
    sample_rate: Only yield every Nth frame (default from settings)
    """

    def __init__(self, path: str | Path, sample_rate: int | None = None):
        self._path = Path(path)
        self._sample_rate = sample_rate or settings.FRAME_SAMPLE_RATE
        self._cap: cv2.VideoCapture | None = None
        self._fps: float = 0.0
        self._total_frames: int = 0
        self._open()

    def _open(self) -> None:
        cap = cv2.VideoCapture(str(self._path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {self._path}")
        self._cap = cap
        self._fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        self._total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def total_frames(self) -> int:
        return self._total_frames

    async def __aiter__(self) -> AsyncIterator[Frame]:
        cap = self._cap
        if cap is None:
            return
        idx = 0
        try:
            while True:
                # Run the blocking read in the executor thread
                ret, bgr = await asyncio.get_event_loop().run_in_executor(
                    None, cap.read
                )
                if not ret:
                    break
                if idx % self._sample_rate == 0:
                    ts_ms = (idx / self._fps) * 1000.0
                    yield Frame(image=bgr, frame_index=idx, timestamp_ms=ts_ms)
                idx += 1
        finally:
            cap.release()
            logger.debug(f"VideoFileSource released: {self._path}")


class RTSPSource(FrameSource):
    """
    Placeholder for future live RTSP stream support.
    Usage: RTSPSource("rtsp://user:pass@host/stream1")
    Currently raises NotImplementedError — swap the VideoFileSource for this
    in pipeline.py when real cameras are available.
    """

    def __init__(self, rtsp_url: str, sample_rate: int | None = None):
        self._url = rtsp_url
        self._sample_rate = sample_rate or settings.FRAME_SAMPLE_RATE
        # VideoCapture works for RTSP too — same implementation as VideoFileSource
        # with reconnection logic added.
        raise NotImplementedError(
            "RTSPSource is stubbed. Use VideoFileSource for file-based feeds. "
            "To implement RTSP: replace VideoFileSource with this class and handle "
            "cv2.VideoCapture(rtsp_url) with reconnection/keepalive logic."
        )

    @property
    def fps(self) -> float:
        return 25.0

    @property
    def total_frames(self) -> int:
        return -1  # unknown for live streams

    async def __aiter__(self) -> AsyncIterator[Frame]:
        raise NotImplementedError
