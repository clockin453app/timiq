from pathlib import Path
from typing import Protocol


class StorageBackend(Protocol):
    def healthcheck(self) -> bool: ...

    def build_path(self, relative_path: str) -> Path: ...
