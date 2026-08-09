"""Migration revision for site progress classification columns."""

from __future__ import annotations

from pathlib import Path


def test_classification_migration_revises_current_head() -> None:
    root = Path(__file__).resolve().parents[1] / "migrations" / "versions"
    path = root / "f8a9b0c1d2e3_site_progress_classification_fields.py"
    text = path.read_text(encoding="utf-8")
    assert 'revision: str = "f8a9b0c1d2e3"' in text
    assert 'down_revision: Union[str, Sequence[str], None] = "e7f8a9b0c1d2"' in text
    for column in ("work_category", "elevation", "elevation_custom", "level"):
        assert column in text
