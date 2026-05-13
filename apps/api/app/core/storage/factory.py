from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.core.storage.base import StorageBackend
from app.core.storage.local import LocalStorageBackend


def storage_root_explicitly_configured() -> bool:
    return bool(settings.timiq_storage_root.strip())


@lru_cache(maxsize=1)
def get_storage_backend() -> StorageBackend:
    backend_name = settings.timiq_storage_backend.strip().lower()
    if backend_name == "s3":
        from app.core.storage.s3 import S3StorageBackend

        return S3StorageBackend(
            bucket=settings.timiq_s3_bucket,
            region=settings.timiq_s3_region,
            endpoint_url=settings.timiq_s3_endpoint_url,
            access_key_id=settings.timiq_s3_access_key_id,
            secret_access_key=settings.timiq_s3_secret_access_key,
            key_prefix=settings.timiq_s3_prefix,
            force_path_style=settings.timiq_s3_force_path_style,
        )

    configured_root = settings.timiq_storage_root.strip()
    storage_root = Path(configured_root) if configured_root else Path("C:/timiq-storage")
    return LocalStorageBackend(storage_root)
