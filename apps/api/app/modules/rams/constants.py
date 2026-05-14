from __future__ import annotations

ASSESSMENT_STATUSES = frozenset({"draft", "published", "reviewed", "archived"})
RISK_LEVELS = frozenset({"low", "medium", "high", "critical"})
ACK_STATUSES = frozenset({"pending", "acknowledged", "declined"})

HAZARD_EXAMPLE_PRESETS: list[str] = [
    "Working at height",
    "Manual handling",
    "Slips, trips and falls",
    "Electrical work",
    "Excavations",
    "Lifting operations",
    "Vehicle movements",
    "Plant and machinery",
    "Noise",
    "Dust/silica",
    "COSHH / hazardous substances",
    "Fire / hot works",
    "Weather",
    "Public interface",
    "Lone working",
    "Other",
]

PPE_OPTION_PRESETS: list[str] = [
    "Hard hat",
    "Hi-vis vest/jacket",
    "Safety boots",
    "Gloves",
    "Eye protection",
    "Hearing protection",
    "Respiratory protection",
    "Harness / fall arrest",
    "Dust mask",
    "Other",
]


def risk_score(likelihood: int, severity: int) -> int:
    return int(likelihood) * int(severity)


def risk_band(score: int) -> str:
    """Map 1–25 product-style band."""
    if score <= 5:
        return "low"
    if score <= 10:
        return "medium"
    if score <= 15:
        return "high"
    return "critical"
