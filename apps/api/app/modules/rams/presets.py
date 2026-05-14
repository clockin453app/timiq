"""RAMS professional assessment presets (module alias for SAFETY-OPS-2).

Implementation lives in document_presets.py; this module exists for a stable import path.
"""

from app.modules.rams.document_presets import (  # noqa: F401
    RAMS_DOCUMENT_PRESETS,
    document_preset_public,
    get_document_preset_by_id,
)

__all__ = ["RAMS_DOCUMENT_PRESETS", "document_preset_public", "get_document_preset_by_id"]
