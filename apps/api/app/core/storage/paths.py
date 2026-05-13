"""Sanitise relative storage keys stored in the database (no absolute paths, no traversal)."""


def sanitize_relative_storage_key(raw: str) -> str:
    """Return a normalised relative key using forward slashes; drop empty and '..' segments."""
    s = (raw or "").strip().replace("\\", "/").lstrip("/")
    if not s:
        raise ValueError("Empty storage key.")
    parts: list[str] = []
    for segment in s.split("/"):
        seg = segment.strip()
        if not seg or seg == "..":
            continue
        parts.append(seg)
    if not parts:
        raise ValueError("Invalid storage key.")
    return "/".join(parts)
