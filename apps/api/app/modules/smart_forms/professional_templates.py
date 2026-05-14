"""Ready-to-use smart form template definitions (validated against schema rules)."""

from __future__ import annotations

from typing import Any, TypedDict


class ProfessionalFormTemplateDict(TypedDict):
    id: str
    name: str
    category: str
    description: str
    requires_location: bool
    requires_signature: bool
    allow_photos: bool
    form_schema: dict[str, Any]


def _sec(sid: str, title: str, fields: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": sid, "title": title, "fields": fields}


def _yn(fid: str, label: str) -> dict[str, Any]:
    return {"id": fid, "type": "yes_no", "label": label, "required": True}


def _ta(fid: str, label: str, *, required: bool = False) -> dict[str, Any]:
    return {"id": fid, "type": "textarea", "label": label, "required": required}


PROFESSIONAL_FORM_TEMPLATES: list[ProfessionalFormTemplateDict] = [
    {
        "id": "daily_site_checklist",
        "name": "Daily site checklist",
        "category": "daily_checklist",
        "description": "Start-of-day checks for access, welfare, and basic site order.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "daily_checks",
                    "Daily checks",
                    [
                        _yn("gates_secure", "Site gates and perimeter secure?"),
                        _yn("welfare_ok", "Welfare facilities clean and stocked?"),
                        _yn("weather_ok", "Weather conditions acceptable for planned work?"),
                        _yn("briefing_done", "Relevant briefing or RAMS reminder completed?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "equipment_prestart",
        "name": "Equipment pre-start check",
        "category": "equipment_check",
        "description": "Basic pre-use checks before operating small plant or power tools.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "prestart",
                    "Pre-start",
                    [
                        _yn("visual_ok", "Visual inspection: no obvious damage or leaks?"),
                        _yn("guards_ok", "Guards and safety devices in place?"),
                        _yn("emergency_stop", "Emergency stop / isolator tested where fitted?"),
                        _yn("competent_operator", "Operator trained and authorised for this equipment?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "hs_inspection_basic",
        "name": "Health & safety inspection",
        "category": "hs_inspection",
        "description": "General H&S walkthrough checklist for supervisors.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "walkthrough",
                    "Walkthrough",
                    [
                        _yn("walkways_clear", "Walkways and access routes clear and lit?"),
                        _yn("edge_protection", "Open edges and holes adequately protected?"),
                        _yn("fire_exits", "Fire exits and extinguishers unobstructed?"),
                        _yn("first_aid", "First aid kit present and known to team?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "scaffold_access_basic",
        "name": "Scaffold / access inspection (basic)",
        "category": "scaffold_inspection",
        "description": "High-level scaffold or tower checks — not a handover certificate.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "access",
                    "Access structure",
                    [
                        _yn("base_plates", "Base plates / sole boards satisfactory?"),
                        _yn("ties_present", "Ties / stabilisers present as expected (if applicable)?"),
                        _yn("guardrails", "Guardrails and toe boards in place on working lifts?"),
                        _yn("ladder_access", "Ladder access secure and extends adequately?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "ppe_compliance_check",
        "name": "PPE compliance check",
        "category": "ppe_compliance",
        "description": "Verify minimum PPE for the work area and task.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": False,
        "form_schema": {
            "sections": [
                _sec(
                    "ppe",
                    "PPE",
                    [
                        _yn("hard_hats", "Hard hats worn and in good condition?"),
                        _yn("footwear", "Safety footwear suitable and worn?"),
                        _yn("hiviz", "Hi-vis compliant with site rules?"),
                        _yn("eye_hearing", "Eye / hearing protection worn where required?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "housekeeping_inspection",
        "name": "Housekeeping inspection",
        "category": "housekeeping_inspection",
        "description": "Slips, trips, waste, and materials storage review.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "housekeeping",
                    "Housekeeping",
                    [
                        _yn("waste_managed", "Waste segregated and skips not overloaded?"),
                        _yn("materials_stacked", "Materials stacked safely and not encroaching routes?"),
                        _yn("cables_managed", "Trailing cables managed or protected?"),
                        _yn("wet_areas", "Wet or contaminated areas signed or treated?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "fire_point_inspection",
        "name": "Fire point inspection",
        "category": "fire_point_inspection",
        "description": "Extinguishers, signage, and access to fire points.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "fire_point",
                    "Fire point",
                    [
                        _yn("extinguisher_present", "Correct extinguisher type present and in date?"),
                        _yn("clear_access", "Fire point and escape routes clear?"),
                        _yn("signage", "Fire signage visible and correct?"),
                        _yn("hot_work", "No unauthorised hot work within exclusion zone?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "delivery_visitor_checklist",
        "name": "Delivery / visitor checklist",
        "category": "delivery_visitor",
        "description": "Logistics gate checks for deliveries and visitors.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": False,
        "form_schema": {
            "sections": [
                _sec(
                    "gate",
                    "Gate / delivery",
                    [
                        _yn("induction_done", "Site rules / PPE explained to visitor or driver?"),
                        _yn("vehicle_secure", "Vehicle parked safely and handbrake applied?"),
                        _yn("exclusion", "Pedestrian / plant segregation maintained during unload?"),
                        _yn("paperwork", "Delivery paperwork matches load (high level)?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "end_of_day_site_close",
        "name": "End-of-day site close checklist",
        "category": "site_close_checklist",
        "description": "Secure the site before leaving for the day.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "close",
                    "Close down",
                    [
                        _yn("tools_secured", "Tools and plant secured or removed from exposure?"),
                        _yn("power_isolated", "Non-essential power isolated where required?"),
                        _yn("gates_locked", "Gates locked and keys managed per site rules?"),
                        _yn("hazards_reported", "Outstanding hazards reported to site management?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "near_miss_report",
        "name": "Near miss report",
        "category": "near_miss",
        "description": "Capture a near miss so controls can be reviewed before someone is hurt.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "event",
                    "What happened",
                    [
                        _ta("what_happened", "Describe what nearly happened", required=True),
                        _ta("where_when", "Where and when (approximate)", required=True),
                        _yn("immediate_control", "Was the situation made safe immediately?"),
                    ],
                ),
                _sec(
                    "follow_up",
                    "Follow-up",
                    [
                        _ta("suggested_controls", "Suggested controls or communication", required=False),
                        _yn("reported_to_supervisor", "Reported verbally to site supervisor?"),
                    ],
                ),
            ],
        },
    },
    {
        "id": "defect_snag_report",
        "name": "Defect / snag report",
        "category": "defect_snag",
        "description": "Record a defect or snag for rectification tracking.",
        "requires_location": True,
        "requires_signature": False,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _sec(
                    "defect",
                    "Defect details",
                    [
                        _ta("defect_title", "Short title", required=True),
                        _ta("defect_description", "Description and location detail", required=True),
                        _yn("safety_related", "Could this affect safety if not corrected?"),
                    ],
                ),
                _sec(
                    "rectification",
                    "Rectification",
                    [
                        _ta("recommended_action", "Recommended action / trade", required=False),
                        _yn("access_impact", "Does defect affect access or egress?"),
                    ],
                ),
            ],
        },
    },
]


def list_professional_template_dicts() -> list[dict[str, Any]]:
    return [dict(t) for t in PROFESSIONAL_FORM_TEMPLATES]


def _validate_templates() -> None:
    from app.modules.smart_forms.schema_validate import assert_known_category, validate_template_schema

    for t in PROFESSIONAL_FORM_TEMPLATES:
        validate_template_schema(t["form_schema"])
        assert_known_category(t["category"])


_validate_templates()
