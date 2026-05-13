from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class StorageBackend(Protocol):
    """Blob storage: DB keeps relative keys only; bytes never appear in public JSON."""

    def healthcheck(self) -> bool: ...

    def get_backend_name(self) -> str:
        """Return ``local`` or ``s3``."""

    def can_build_local_path(self) -> bool:
        """True only for the local disk backend (internal tooling / migrations)."""

    def build_path(self, relative_path: str) -> Path:
        """Resolve to an absolute path on disk. Raises if not supported (e.g. S3)."""

    def write_bytes(self, relative_path: str, data: bytes) -> None: ...

    def read_bytes(self, relative_path: str) -> bytes: ...

    def delete_file(self, relative_path: str) -> None: ...

    def exists(self, relative_path: str) -> bool: ...

    def writable_probe(self) -> bool: ...
