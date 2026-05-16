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


def _field(fid: str, label: str, ftype: str = "text", *, required: bool = False, options: list[str] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"id": fid, "type": ftype, "label": label, "required": required}
    if options is not None:
        out["options"] = options
    return out


def _yn(fid: str, label: str, *, required: bool = True) -> dict[str, Any]:
    return _field(fid, label, "yes_no", required=required)


def _ta(fid: str, label: str, *, required: bool = False) -> dict[str, Any]:
    return _field(fid, label, "textarea", required=required)


def _txt(fid: str, label: str, *, required: bool = False) -> dict[str, Any]:
    return _field(fid, label, "text", required=required)


def _date(fid: str, label: str, *, required: bool = False) -> dict[str, Any]:
    return _field(fid, label, "date", required=required)


def _select(fid: str, label: str, options: list[str], *, required: bool = False) -> dict[str, Any]:
    return _field(fid, label, "select", required=required, options=options)


def _common_company() -> dict[str, Any]:
    return _sec(
        "company_details",
        "Company details",
        [
            _txt("company_name", "Company name", required=True),
            _txt("company_reference", "Company registration / reference"),
            _txt("supervisor_name", "Supervisor / manager name", required=True),
            _txt("company_contact_number", "Contact number"),
            _txt("company_email", "Email"),
        ],
    )


def _common_site(*, weather: bool = False) -> dict[str, Any]:
    fields = [
        _txt("site_name", "Site name", required=True),
        _ta("site_address", "Site address", required=True),
        _date("form_date", "Date", required=True),
        _txt("form_time", "Time"),
        _txt("work_area", "Work area / plot / zone"),
    ]
    if weather:
        fields.append(_txt("weather_conditions", "Weather conditions"))
    return _sec("site_details", "Site details", fields)


def _common_employee(title: str = "Employee / operative details") -> dict[str, Any]:
    return _sec(
        "employee_details",
        title,
        [
            _txt("employee_name", "Employee name", required=True),
            _txt("role_trade", "Role / trade"),
            _txt("subcontractor_company", "Company / subcontractor"),
            _txt("employee_contact_number", "Contact number"),
        ],
    )


def _corrective_actions() -> dict[str, Any]:
    return _sec(
        "corrective_actions",
        "Corrective actions",
        [
            _ta("action_required", "Action required"),
            _txt("responsible_person", "Responsible person"),
            _date("target_date", "Target date"),
            _yn("action_completed", "Completed?", required=False),
        ],
    )


def _sign_off(*, employee: bool = True, supervisor: bool = True) -> dict[str, Any]:
    fields: list[dict[str, Any]] = []
    if employee:
        fields.extend(
            [
                _txt("employee_printed_name", "Employee name printed", required=True),
                _yn("employee_declaration", "Employee confirms the information is accurate", required=True),
            ]
        )
    if supervisor:
        fields.extend(
            [
                _txt("supervisor_printed_name", "Supervisor name printed", required=True),
                _date("date_signed", "Date signed", required=True),
            ]
        )
    return _sec("sign_off", "Sign-off", fields)


PROFESSIONAL_FORM_TEMPLATES: list[ProfessionalFormTemplateDict] = [
    {
        "id": "daily_site_checklist",
        "name": "Daily Site Checklist",
        "category": "daily_checklist",
        "description": "Daily supervisor checklist for site access, welfare, housekeeping, plant, materials, issues, and sign-off.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(weather=True),
                _sec("access_housekeeping", "Access and housekeeping", [_yn("access_clear", "Access routes clear?"), _yn("housekeeping_ok", "Housekeeping acceptable?"), _yn("fire_point_accessible", "Fire point accessible?")]),
                _sec("ppe_welfare", "PPE and welfare", [_yn("ppe_worn", "PPE being worn?"), _yn("welfare_available", "Welfare facilities available?"), _yn("first_aid_available", "First aid available?")]),
                _sec("working_area", "Working area safety", [_yn("unsafe_conditions", "Any unsafe conditions?", required=True), _ta("unsafe_condition_notes", "Unsafe condition details / comments")]),
                _sec("plant_waste", "Plant, waste, and materials", [_yn("plant_safe", "Plant/equipment safe for planned work?"), _yn("waste_controlled", "Waste controlled?"), _yn("materials_stored", "Materials stored safely?")]),
                _sec("issues_actions", "Issues and actions", [_ta("issues_found", "Issues found / photo references"), _ta("actions_taken", "Actions taken today")]),
                _sign_off(employee=False, supervisor=True),
            ],
        },
    },
    {
        "id": "equipment_prestart_check",
        "name": "Equipment Pre-start Check",
        "category": "equipment_check",
        "description": "Operator pre-use check for plant, equipment, safety controls, defects, evidence photos, and declarations.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(),
                _common_employee("Operator details"),
                _sec("equipment_details", "Equipment details", [_txt("equipment_type", "Equipment type", required=True), _txt("plant_number", "Plant number / asset ID", required=True), _txt("operator_name", "Operator name", required=True)]),
                _sec("visual_inspection", "Visual inspection", [_yn("tyres_tracks_ok", "Tyres/tracks acceptable?"), _yn("guards_ok", "Guards in place?"), _yn("lights_alarms_ok", "Lights/alarms working?"), _yn("no_leaks", "No visible leaks?")]),
                _sec("safety_controls", "Safety controls", [_yn("brakes_ok", "Brakes working?"), _yn("emergency_stop_ok", "Emergency stop works?"), _yn("seatbelt_ok", "Seatbelt/restraint available where required?")]),
                _sec("defects", "Defects", [_yn("defect_found", "Defect found?"), _ta("defect_notes", "Defect notes / photo references"), _yn("taken_out_of_service", "Taken out of service if unsafe?", required=False)]),
                _sign_off(employee=True, supervisor=True),
            ],
        },
    },
    {
        "id": "health_safety_inspection",
        "name": "Health & Safety Inspection",
        "category": "hs_inspection",
        "description": "Structured H&S inspection covering site conditions, height work, excavation, plant, electrical, fire, welfare, and actions.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(weather=True),
                _sec("inspection_details", "Inspection details", [_txt("inspector_name", "Inspector name", required=True), _select("inspection_type", "Inspection type", ["Routine", "Follow-up", "Incident related"], required=True)]),
                _sec("site_conditions", "Site conditions", [_yn("access_safe", "Access/egress safe?"), _yn("housekeeping_satisfactory", "Housekeeping satisfactory?"), _yn("segregation_ok", "Pedestrian/plant segregation in place?")]),
                _sec("height_excavations", "Working at height and excavations", [_yn("height_controls", "Working at height controls in place?"), _yn("excavations_safe", "Excavations/access protected where applicable?")]),
                _sec("plant_electrical_fire", "Plant, electrical, fire, and welfare", [_yn("plant_controls_ok", "Plant/equipment controls acceptable?"), _yn("electrical_safe", "Electrical safety controls acceptable?"), _yn("fire_emergency_ok", "Fire and emergency arrangements in place?"), _yn("welfare_ok", "Welfare acceptable?")]),
                _sec("findings", "Findings / corrective actions", [_ta("hazard_issue", "Hazard / issue"), _select("risk_level", "Risk level", ["Low", "Medium", "High", "Immediate stop"], required=True), _ta("corrective_action", "Corrective action"), _txt("responsible_person", "Responsible person"), _date("due_date", "Due date")]),
                _sign_off(employee=False, supervisor=True),
            ],
        },
    },
    {
        "id": "scaffold_access_inspection",
        "name": "Scaffold / Access Inspection",
        "category": "scaffold_inspection",
        "description": "Inspection record for scaffold, towers, ladders, platforms, weather impact, defects, and inspector sign-off.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(weather=True),
                _sec("access_equipment", "Scaffold/access equipment details", [_txt("access_type", "Access equipment type", required=True), _txt("reference", "Scaffold/tag/reference"), _txt("inspection_reason", "Inspection reason")]),
                _sec("inspection_checklist", "Inspection checklist", [_yn("access_safe", "Access safe?"), _yn("platform_complete", "Platform complete?"), _yn("guardrails_toeboards", "Guardrails/toeboards present?"), _yn("ties_bracing_secure", "Ties/bracing secure?"), _yn("loading_acceptable", "Loading acceptable?"), _yn("ladders_stairs_safe", "Ladders/stairs safe?"), _yn("weather_impact", "Weather impact assessed?")]),
                _sec("defects_actions", "Defects/actions", [_yn("defects_found", "Defects found?"), _ta("defect_details", "Defect details / photo references"), _ta("action_taken", "Action taken")]),
                _sign_off(employee=False, supervisor=True),
            ],
        },
    },
    {
        "id": "ppe_compliance_check",
        "name": "PPE Compliance Check",
        "category": "ppe_compliance",
        "description": "Team or individual PPE check with non-compliance actions, employee acknowledgement, and supervisor sign-off.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(),
                _common_employee("Employee/team details"),
                _sec("ppe_checks", "PPE checks", [_yn("hard_hat", "Hard hat compliant?"), _yn("hi_vis", "Hi-vis compliant?"), _yn("safety_boots", "Safety boots compliant?"), _yn("gloves", "Gloves worn where required?"), _yn("eye_protection", "Eye protection worn where required?"), _yn("hearing_protection", "Hearing protection worn where required?"), _yn("respiratory_protection", "Respiratory protection worn where required?")]),
                _sec("non_compliance", "Non-compliance actions", [_ta("non_compliance_details", "Non-compliance details / photo references"), _ta("action_taken", "Action taken")]),
                _sign_off(employee=True, supervisor=True),
            ],
        },
    },
    {
        "id": "toolbox_talk_attendance",
        "name": "Toolbox Talk Attendance",
        "category": "general",
        "description": "Attendance and acknowledgement record for toolbox talks, topics, key points, questions, and signatures.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": False,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(),
                _sec("talk_details", "Talk details", [_txt("topic", "Topic", required=True), _txt("presenter", "Presenter", required=True), _date("talk_date", "Talk date", required=True), _txt("talk_time", "Talk time")]),
                _sec("key_points", "Key points", [_ta("key_points", "Key points covered", required=True), _ta("questions_concerns", "Questions / concerns")]),
                _sec("attendees", "Attendees", [_ta("attendee_names", "Attendee names / signature references", required=True)]),
                _sign_off(employee=True, supervisor=True),
            ],
        },
    },
    {
        "id": "rams_briefing_signoff",
        "name": "RAMS Briefing Sign-off",
        "category": "general",
        "description": "Employee declaration for RAMS briefing, work activity, hazards, controls, permit requirements, PPE, and signatures.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": False,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(),
                _common_employee(),
                _sec("rams_details", "RAMS details", [_txt("rams_title_reference", "RAMS title/reference", required=True), _ta("work_activity", "Work activity", required=True), _yn("permit_required", "Permit required?"), _ta("ppe_required", "PPE required")]),
                _sec("hazards_controls", "Key hazards and controls", [_ta("key_hazards", "Key hazards", required=True), _ta("control_measures", "Control measures", required=True)]),
                _sec("employee_declaration", "Employee declaration", [_yn("understands_rams", "I understand the RAMS and will follow the controls", required=True)]),
                _sign_off(employee=True, supervisor=True),
            ],
        },
    },
    {
        "id": "near_miss_incident_report",
        "name": "Near Miss / Incident Report",
        "category": "near_miss",
        "description": "Reporter-led near miss or incident record with details, people involved, evidence, immediate actions, investigation, and manager sign-off.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(),
                _common_employee("Reporter details"),
                _sec("incident_details", "Incident details", [_date("incident_date", "Date", required=True), _txt("incident_time", "Time"), _ta("what_happened", "What happened?", required=True), _ta("potential_injury_damage", "Potential injury/damage")]),
                _sec("persons_actions", "Persons involved and immediate actions", [_ta("persons_involved", "Persons involved"), _ta("immediate_action", "Immediate action taken", required=True), _yn("further_action_required", "Further action required?")]),
                _sec("evidence_investigation", "Photos/evidence and investigation/actions", [_ta("photo_evidence_refs", "Photo/evidence references"), _ta("investigation_actions", "Investigation/actions")]),
                _sign_off(employee=True, supervisor=True),
            ],
        },
    },
    {
        "id": "defect_snag_report",
        "name": "Defect / Snag Report",
        "category": "defect_snag",
        "description": "Defect or snag report with priority, evidence, assigned action, target date, close-out, and sign-off.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(),
                _sec("defect_details", "Defect details", [_txt("defect_location", "Defect location", required=True), _ta("description", "Description", required=True), _select("priority", "Priority", ["Low", "Medium", "High", "Urgent"], required=True), _ta("photo_refs", "Photo references")]),
                _corrective_actions(),
                _sec("close_out", "Close-out", [_yn("completed", "Completed?"), _ta("close_out_notes", "Close-out notes")]),
                _sign_off(employee=False, supervisor=True),
            ],
        },
    },
    {
        "id": "end_of_day_site_close",
        "name": "End-of-day Site Close",
        "category": "site_close_checklist",
        "description": "End-of-day supervisor check covering security, housekeeping, plant, materials, waste, fire risk, and final sign-off.",
        "requires_location": True,
        "requires_signature": True,
        "allow_photos": True,
        "form_schema": {
            "sections": [
                _common_company(),
                _common_site(),
                _sec("security", "Security", [_yn("tools_secured", "Tools secured?"), _yn("access_gates_locked", "Access gates locked?")]),
                _sec("housekeeping", "Housekeeping", [_yn("materials_stored", "Materials stored safely?"), _yn("waste_controlled", "Waste controlled?")]),
                _sec("plant_fire", "Plant/materials and fire risk", [_yn("plant_isolated", "Plant isolated?"), _yn("fire_risks_controlled", "Fire risks controlled?")]),
                _sec("final_notes", "Final notes", [_ta("final_notes", "Final notes / handover comments")]),
                _sign_off(employee=False, supervisor=True),
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
