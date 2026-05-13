from pathlib import Path

from app.core.storage.paths import sanitize_relative_storage_key


class LocalStorageBackend:
    """On-disk storage under a single root. DB values are relative POSIX-style keys."""

    def __init__(self, root_path: Path):
        self.root_path = root_path
        self.root_path.mkdir(parents=True, exist_ok=True)

    def get_backend_name(self) -> str:
        return "local"

    def can_build_local_path(self) -> bool:
        return True

    def healthcheck(self) -> bool:
        return self.root_path.exists() and self.root_path.is_dir()

    def writable_probe(self) -> bool:
        try:
            probe = self.root_path / ".timiq_health_write_probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return True
        except OSError:
            return False

    def build_path(self, relative_path: str) -> Path:
        key = sanitize_relative_storage_key(relative_path)
        return self.root_path.joinpath(*key.split("/"))

    def write_bytes(self, relative_path: str, data: bytes) -> None:
        path = self.build_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read_bytes(self, relative_path: str) -> bytes:
        path = self.build_path(relative_path)
        return path.read_bytes()

    def delete_file(self, relative_path: str) -> None:
        if not relative_path.strip():
            return
        path = self.build_path(relative_path)
        path.unlink(missing_ok=True)

    def exists(self, relative_path: str) -> bool:
        try:
            return self.build_path(relative_path).is_file()
        except ValueError:
            return False
