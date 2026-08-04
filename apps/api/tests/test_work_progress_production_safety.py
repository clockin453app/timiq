"""Production-safety checks for Work Progress upload concurrency and responsiveness."""

from __future__ import annotations

import io
import threading
import time
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.work_progress.image_processing import process_site_progress_photo
from app.modules.work_progress.thumbnail_sync import work_progress_image_processing_semaphore


def _jpeg_bytes(width: int, height: int) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (width, height), (20, 40, 60)).save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def test_healthz_responds_while_image_semaphore_is_held() -> None:
    """Lightweight API must remain responsive while Pillow work holds the shared semaphore."""
    client = TestClient(app)
    sem = work_progress_image_processing_semaphore()
    assert sem.acquire(blocking=False)
    started = time.perf_counter()
    try:
        response = client.get("/api/healthz")
        elapsed_ms = (time.perf_counter() - started) * 1000
    finally:
        sem.release()

    assert response.status_code == 200
    assert elapsed_ms < 2000, f"healthz took {elapsed_ms:.0f}ms while semaphore held"


def test_upload_route_is_synchronous_not_async() -> None:
    """Sync upload route runs in Starlette's threadpool, not on the asyncio event loop."""
    from app.modules.work_progress.router import post_work_progress_me_file
    import inspect

    assert not inspect.iscoroutinefunction(post_work_progress_me_file)


def test_thumbnail_route_is_synchronous_not_async() -> None:
    from app.modules.work_progress.router import get_work_progress_file_thumbnail
    import inspect

    assert not inspect.iscoroutinefunction(get_work_progress_file_thumbnail)


def test_semaphore_released_after_processing_exception() -> None:
    sem = work_progress_image_processing_semaphore()
    with patch(
        "app.modules.work_progress.image_processing.Image.open",
        side_effect=RuntimeError("boom"),
    ):
        try:
            with sem:
                process_site_progress_photo(b"\xff\xd8\xff\xe0" + b"x" * 32)
        except Exception:
            pass
    assert sem.acquire(blocking=False)
    sem.release()


def test_semaphore_released_after_successful_processing() -> None:
    sem = work_progress_image_processing_semaphore()
    data = _jpeg_bytes(320, 240)
    with sem:
        process_site_progress_photo(data)
    assert sem.acquire(blocking=False)
    sem.release()


def test_concurrent_processing_threads_serialize_on_semaphore() -> None:
    """Two threads cannot decode simultaneously."""
    data = _jpeg_bytes(400, 300)
    active = 0
    peak = 0
    lock = threading.Lock()

    def worker() -> None:
        nonlocal active, peak
        with work_progress_image_processing_semaphore():
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            process_site_progress_photo(data)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert peak == 1
