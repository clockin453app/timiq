"""Stable classification values for Site Progress work category / elevation / level."""

from __future__ import annotations

WORK_CATEGORY_OPTIONS: tuple[tuple[str, str], ...] = (
    ("dpc", "DPC"),
    ("brickwork_ties", "Brickwork ties"),
    ("brickwork_level", "Brickwork level"),
    ("blockwork_level", "Blockwork level"),
    ("blockwork_ties", "Blockwork ties"),
    ("firebreaks", "Firebreaks"),
    ("fire_barrier", "Fire barrier"),
    ("insulation", "Insulation"),
    ("cavity", "Cavity"),
    ("weep_holes", "Weep holes"),
    ("pointing", "Pointing"),
    ("grc_stone", "GRC stone"),
    ("mastic", "Mastic"),
    ("foundation_foam_glass", "Foundation foam glass"),
)

WORK_CATEGORY_VALUES = frozenset(value for value, _label in WORK_CATEGORY_OPTIONS)
WORK_CATEGORY_LABELS = {value: label for value, label in WORK_CATEGORY_OPTIONS}

ELEVATION_OPTIONS: tuple[tuple[str, str], ...] = (
    ("north", "North"),
    ("north_east", "North-East"),
    ("east", "East"),
    ("south_east", "South-East"),
    ("south", "South"),
    ("south_west", "South-West"),
    ("west", "West"),
    ("north_west", "North-West"),
    ("front", "Front"),
    ("rear", "Rear"),
    ("left", "Left"),
    ("right", "Right"),
    ("internal", "Internal"),
    ("external", "External"),
    ("courtyard", "Courtyard"),
    ("street", "Street"),
    ("garden", "Garden"),
    ("custom", "Custom / site-defined"),
)

ELEVATION_VALUES = frozenset(value for value, _label in ELEVATION_OPTIONS)
ELEVATION_LABELS = {value: label for value, label in ELEVATION_OPTIONS}
ELEVATION_CUSTOM = "custom"

LEVEL_MIN = 0
LEVEL_MAX = 20

# Stored in legacy NOT NULL progress_status when classification fields are used.
CLASSIFIED_PROGRESS_STATUS = "classified"

ELEVATION_CUSTOM_MAX_LEN = 100
