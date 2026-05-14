"""Static toolbox talk topics (v1 — no DB presets table)."""

TOOLBOX_TOPIC_VALUES: tuple[str, ...] = (
    "working_at_height",
    "manual_handling",
    "ppe",
    "slips_trips_falls",
    "electrical_safety",
    "fire_safety",
    "excavations",
    "lifting_operations",
    "plant_and_machinery",
    "vehicle_movements",
    "dust_and_silica",
    "noise_and_vibration",
    "coshh_hazardous_substances",
    "hot_works",
    "site_housekeeping",
    "emergency_procedures",
    "weather_conditions",
    "custom",
)

TOOLBOX_TOPIC_LABELS: dict[str, str] = {
    "working_at_height": "Working at height",
    "manual_handling": "Manual handling",
    "ppe": "PPE",
    "slips_trips_falls": "Slips, trips and falls",
    "electrical_safety": "Electrical safety",
    "fire_safety": "Fire safety",
    "excavations": "Excavations",
    "lifting_operations": "Lifting operations",
    "plant_and_machinery": "Plant and machinery",
    "vehicle_movements": "Vehicle movements",
    "dust_and_silica": "Dust and silica",
    "noise_and_vibration": "Noise and vibration",
    "coshh_hazardous_substances": "COSHH / hazardous substances",
    "hot_works": "Hot works",
    "site_housekeeping": "Site housekeeping",
    "emergency_procedures": "Emergency procedures",
    "weather_conditions": "Weather conditions",
    "custom": "Custom",
}


def is_known_topic(value: str) -> bool:
    return value in TOOLBOX_TOPIC_VALUES


def topic_label(value: str) -> str:
    return TOOLBOX_TOPIC_LABELS.get(value, value.replace("_", " ").title())
