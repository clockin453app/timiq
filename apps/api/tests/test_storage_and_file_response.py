"""Storage key sanitization and protected download responses."""

import tempfile
from pathlib import Path

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
