from functools import lru_cache
from os import getenv
from pathlib import Path

from app.core.storage.base import StorageBackend
from app.core.storage.local import LocalStorageBackend


def storage_root_explicitly_configured() -> bool:
    return bool(getenv("TIMIQ_STORAGE_ROOT", "").strip())


@lru_cache(maxsize=1)
def get_storage_backend() -> StorageBackend:
    configured_root = getenv("TIMIQ_STORAGE_ROOT", "").strip()
    storage_root = Path(configured_root) if configured_root else Path("C:/timiq-storage")
    return LocalStorageBackend(storage_root)
