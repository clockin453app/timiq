"""Shared Work Progress image-processing concurrency and thumbnail cache helpers."""

from __future__ import annotations

import hashlib
import threading
import time
from collections import OrderedDict

THUMB_STRIPE_COUNT = 64
# One Pillow decode/resize/encode at a time per API process (uploads + thumbnails).
_WORK_PROGRESS_IMAGE_PROCESSING_SEM = threading.BoundedSemaphore(1)
_THUMB_STRIPES = tuple(threading.Lock() for _ in range(THUMB_STRIPE_COUNT))

_FAILURE_CACHE_MAX = 256
_FAILURE_TTL_SEC = 60.0
_failure_lock = threading.Lock()
_failure_cache: OrderedDict[str, float] = OrderedDict()


def work_progress_image_processing_semaphore() -> threading.BoundedSemaphore:
    return _WORK_PROGRESS_IMAGE_PROCESSING_SEM


def thumb_stripe_index(storage_key: str) -> int:
    digest = hashlib.sha256(storage_key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % THUMB_STRIPE_COUNT


def thumb_stripe_lock(storage_key: str) -> threading.Lock:
    return _THUMB_STRIPES[thumb_stripe_index(storage_key)]


def thumb_decode_semaphore() -> threading.BoundedSemaphore:
    """Alias for the shared work-progress image-processing semaphore."""
    return _WORK_PROGRESS_IMAGE_PROCESSING_SEM


def mark_thumb_failure(storage_key: str) -> None:
    now = time.monotonic()
    with _failure_lock:
        _failure_cache[storage_key] = now
        _failure_cache.move_to_end(storage_key)
        while len(_failure_cache) > _FAILURE_CACHE_MAX:
            _failure_cache.popitem(last=False)


def clear_thumb_failure(storage_key: str) -> None:
    with _failure_lock:
        _failure_cache.pop(storage_key, None)


def thumb_failure_hot(storage_key: str) -> bool:
    now = time.monotonic()
    with _failure_lock:
        ts = _failure_cache.get(storage_key)
        if ts is None:
            return False
        if now - ts > _FAILURE_TTL_SEC:
            _failure_cache.pop(storage_key, None)
            return False
        _failure_cache.move_to_end(storage_key)
        return True
