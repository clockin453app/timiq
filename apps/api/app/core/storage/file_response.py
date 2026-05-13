"""Build safe attachment responses without exposing storage paths."""

from urllib.parse import quote

from starlette.responses import Response


def _ascii_fallback_filename(name: str) -> str:
    out = []
    for ch in name[:220]:
        if 32 <= ord(ch) < 127 and ch not in ('"', "\\"):
            out.append(ch)
        else:
            out.append("_")
    return "".join(out) or "download"


def content_disposition_attachment(download_filename: str) -> str:
    """RFC 6266 / 5987 style Content-Disposition for UTF-8 filenames."""
    safe = _ascii_fallback_filename(download_filename)
    encoded = quote(download_filename, safe="")
    return f"attachment; filename=\"{safe}\"; filename*=UTF-8''{encoded}"


def protected_file_response(
    *,
    body: bytes,
    download_filename: str,
    media_type: str,
) -> Response:
    """Return bytes as a download. Large bodies are held in memory (see storage docs)."""
    headers = {"Content-Disposition": content_disposition_attachment(download_filename)}
    return Response(content=body, media_type=media_type or "application/octet-stream", headers=headers)
