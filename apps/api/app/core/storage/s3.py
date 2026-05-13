from __future__ import annotations

from pathlib import Path

from app.core.storage.paths import sanitize_relative_storage_key


class S3StorageBackend:
    """S3-compatible private object storage (AWS S3, R2, Spaces, MinIO). Keys are never exposed via API."""

    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        endpoint_url: str | None,
        access_key_id: str,
        secret_access_key: str,
        key_prefix: str,
        force_path_style: bool,
    ) -> None:
        import boto3
        from botocore.config import Config

        self._bucket = bucket.strip()
        self._prefix = key_prefix.strip().strip("/")
        addressing = "path" if force_path_style else "virtual"
        cfg = Config(signature_version="s3v4", s3={"addressing_style": addressing})
        self._client = boto3.client(
            "s3",
            region_name=region.strip() or None,
            endpoint_url=endpoint_url.strip() if endpoint_url and endpoint_url.strip() else None,
            aws_access_key_id=access_key_id.strip(),
            aws_secret_access_key=secret_access_key.strip(),
            config=cfg,
        )

    def _object_key(self, relative_path: str) -> str:
        key = sanitize_relative_storage_key(relative_path)
        if self._prefix:
            return f"{self._prefix}/{key}"
        return key

    def get_backend_name(self) -> str:
        return "s3"

    def can_build_local_path(self) -> bool:
        return False

    def build_path(self, relative_path: str) -> Path:
        raise RuntimeError("Local filesystem paths are not available for the S3 storage backend.")

    def healthcheck(self) -> bool:
        try:
            self._client.head_bucket(Bucket=self._bucket)
            return True
        except Exception:
            try:
                self._client.list_objects_v2(Bucket=self._bucket, MaxKeys=1)
                return True
            except Exception:
                return False

    def writable_probe(self) -> bool:
        from uuid import uuid4

        probe_key = self._object_key(f".timiq-probes/{uuid4().hex}.txt")
        try:
            self._client.put_object(Bucket=self._bucket, Key=probe_key, Body=b"ok", ContentType="text/plain")
            self._client.delete_object(Bucket=self._bucket, Key=probe_key)
            return True
        except Exception:
            return False

    def write_bytes(self, relative_path: str, data: bytes) -> None:
        key = self._object_key(relative_path)
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data)

    def read_bytes(self, relative_path: str) -> bytes:
        from botocore.exceptions import ClientError

        key = self._object_key(relative_path)
        try:
            obj = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                raise FileNotFoundError(key) from exc
            raise
        body = obj["Body"].read()
        if not isinstance(body, bytes):
            return bytes(body)
        return body

    def delete_file(self, relative_path: str) -> None:
        if not relative_path.strip():
            return
        from botocore.exceptions import ClientError

        key = self._object_key(relative_path)
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except ClientError:
            return

    def exists(self, relative_path: str) -> bool:
        from botocore.exceptions import ClientError

        key = self._object_key(relative_path)
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False
