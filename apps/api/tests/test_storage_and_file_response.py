"""Storage key sanitization and protected download responses."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.core.storage.file_response import protected_file_response
from app.core.storage.local import LocalStorageBackend
from app.core.storage.paths import sanitize_relative_storage_key


def test_sanitize_relative_storage_key_strips_traversal() -> None:
    assert sanitize_relative_storage_key("a/../b/c") == "a/b/c"
    assert sanitize_relative_storage_key("/x/y/z") == "x/y/z"


def test_local_build_path_stays_under_root() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        backend = LocalStorageBackend(root)
        key = "safe/sub/file.bin"
        p = backend.build_path(key)
        assert p.is_relative_to(root)
        assert p == root / "safe" / "sub" / "file.bin"


def test_protected_file_response_headers_no_storage_path() -> None:
    resp = protected_file_response(body=b"x", download_filename="a.pdf", media_type="application/pdf")
    keys = {k.lower() for k in resp.headers.keys()}
    assert "storage_path" not in keys
    assert "content-disposition" in keys


def test_protected_inline_image_response_headers() -> None:
    from app.core.storage.file_response import protected_inline_image_response

    resp = protected_inline_image_response(body=b"jpeg", download_filename="t.jpg")
    assert resp.media_type == "image/jpeg"
    assert "inline" in resp.headers["content-disposition"]
    assert resp.headers["cache-control"] == "private, no-store"
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_failed_local_atomic_replace_cleans_unique_temp(tmp_path, monkeypatch) -> None:
    from app.core.storage.local import LocalStorageBackend

    backend = LocalStorageBackend(tmp_path)

    def fail_replace(*_args) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr("app.core.storage.local.os.replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        backend.write_bytes_replace("work-progress-files/thumb.jpg", b"jpeg")

    assert not (tmp_path / "work-progress-files" / "thumb.jpg").exists()
    assert list(tmp_path.rglob("*.tmp")) == []


def test_failed_s3_final_put_propagates_without_temporary_object() -> None:
    from app.core.storage.s3 import S3StorageBackend

    backend = object.__new__(S3StorageBackend)
    backend._bucket = "bucket"
    backend._prefix = ""
    backend._client = MagicMock()
    backend._client.put_object.side_effect = RuntimeError("put failed")

    with pytest.raises(RuntimeError, match="put failed"):
        backend.write_bytes_replace("work-progress-files/thumb.jpg", b"jpeg")

    backend._client.put_object.assert_called_once()
    assert backend._client.put_object.call_args.kwargs["Key"] == "work-progress-files/thumb.jpg"
