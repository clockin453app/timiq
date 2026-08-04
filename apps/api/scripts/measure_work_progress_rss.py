#!/usr/bin/env python3
"""Measure Work Progress image-processing RSS on Linux (POSIX resource module required)."""

from __future__ import annotations

import gc
import io
import os
import resource
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image

from app.modules.work_progress.image_processing import ImageProcessingError, process_site_progress_photo
from app.modules.work_progress.thumbnail import build_thumbnail_jpeg_bytes
from app.modules.work_progress.thumbnail_sync import work_progress_image_processing_semaphore


def rss_kb() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def jpeg_bytes(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (30, 60, 90)).save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def process_one(data: bytes) -> None:
    with work_progress_image_processing_semaphore():
        out, _w, _h = process_site_progress_photo(data)
        build_thumbnail_jpeg_bytes(out)


def run_batch(count: int, width: int, height: int) -> dict[str, int]:
    gc.collect()
    before = rss_kb()
    peak = before
    data = jpeg_bytes(width, height)
    for _ in range(count):
        process_one(data)
        peak = max(peak, rss_kb())
    gc.collect()
    after = rss_kb()
    return {"before_kb": before, "peak_kb": peak, "after_kb": after}


def main() -> int:
    if not hasattr(resource, "getrusage"):
        print("ERROR: POSIX resource module required", file=sys.stderr)
        return 1

    baseline = rss_kb()
    print(f"baseline_rss_kb={baseline}")

    img_12 = jpeg_bytes(4000, 3000)
    with work_progress_image_processing_semaphore():
        t0 = rss_kb()
        out, w, h = process_site_progress_photo(img_12)
        peak_12 = max(t0, rss_kb())
    print(f"single_12mp_peak_kb={peak_12} output={w}x{h} bytes={len(out)}")

    img_24 = jpeg_bytes(6000, 4000)
    rejected = False
    try:
        with work_progress_image_processing_semaphore():
            process_site_progress_photo(img_24)
    except ImageProcessingError:
        rejected = True
    print(f"single_24mp_rejected={rejected}")

    batch1 = run_batch(20, 4000, 3000)
    print(
        "batch_20x12mp "
        f"before_kb={batch1['before_kb']} peak_kb={batch1['peak_kb']} after_kb={batch1['after_kb']}"
    )

    time.sleep(0.2)
    gc.collect()
    batch2 = run_batch(20, 4000, 3000)
    print(
        "batch_20x12mp_repeat "
        f"before_kb={batch2['before_kb']} peak_kb={batch2['peak_kb']} after_kb={batch2['after_kb']}"
    )

    growth = batch2["after_kb"] - batch1["after_kb"]
    print(f"rss_growth_between_batches_kb={growth}")
    under = batch1["peak_kb"] < 350 * 1024 and batch2["peak_kb"] < 350 * 1024
    print(f"under_350mb_peak={under}")

    sem = work_progress_image_processing_semaphore()
    assert sem.acquire(blocking=False)
    blocked = not sem.acquire(blocking=False)
    sem.release()
    print(f"simultaneous_decode_blocked={blocked}")

    return 0 if under and rejected else 1


if __name__ == "__main__":
    raise SystemExit(main())
