from pathlib import Path

from app.core.storage.base import StorageBackend


class LocalStorageBackend(StorageBackend):
    def __init__(self, root_path: Path):
        self.root_path = root_path
        self.root_path.mkdir(parents=True, exist_ok=True)

    def healthcheck(self) -> bool:
        return self.root_path.exists() and self.root_path.is_dir()

    def build_path(self, relative_path: str) -> Path:
        safe_relative = relative_path.strip().lstrip("/").replace("..", "")
        return self.root_path / safe_relative
