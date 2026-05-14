"""Static toolbox talk body templates (English, operational — not legal advice)."""

from __future__ import annotations

from typing import Any, TypedDict


class ToolboxTopicTemplateDict(TypedDict):
    topic: str
    category: str
    default_title: str
    default_body: str
    key_points: list[str]
    required_ppe: list[str]
    do_list: list[str]
    dont_list: list[str]
    ppe_reminders: list[str]


def _tpl(
    topic: str,
    category: str,
    title: str,
    body: str,
    key_points: list[str],
    ppe: list[str],
    *,
    do_list: list[str] | None = None,
    dont_list: list[str] | None = None,
    ppe_reminders: list[str] | None = None,
) -> ToolboxTopicTemplateDict:
    return {
        "topic": topic,
        "category": category,
        "default_title": title,
        "default_body": body,
        "key_points": key_points,
        "required_ppe": ppe,
        "do_list": list(do_list or []),
        "dont_list": list(dont_list or []),
        "ppe_reminders": list(ppe) if ppe_reminders is None else list(ppe_reminders),
    }


TOOLBOX_TOPIC_TEMPLATES: list[ToolboxTopicTemplateDict] = [
    _tpl(
        "manual_handling",
        "People and materials",
        "Toolbox talk: Manual handling",
        "Manual handling injuries remain a leading cause of lost time on site. Today we focus on planning lifts, using aids, and protecting backs and shoulders.\n\n"
        "Discuss recent tasks that involved lifting or moving materials. Confirm everyone knows how to request help or mechanical aids before attempting awkward loads.",
        [
            "Plan the lift: route, grip, team size, and weight estimate before starting.",
            "Use trolleys, hoists, or telehandlers where available; do not improvise beyond SWL.",
            "Keep loads close to the body; avoid twisting while carrying.",
            "Team lifts need one person to call the lift and synchronise the move.",
        ],
        ["Gloves suitable for grip", "Safety footwear", "Hi-vis where vehicles operate"],
        do_list=["Use mechanical aids first", "Tag and report damaged lifting accessories"],
        dont_list=["Do not twist under load", "Do not exceed team lift capability"],
    ),
    _tpl(
        "ppe",
        "Protection",
        "Toolbox talk: PPE",
        "PPE is the last line of defence after elimination, substitution, and engineering controls. It only works when it is correct for the task, fitted, and maintained.\n\n"
        "Walk through the minimum PPE for this site today and any extra controls for the work area (e.g. hearing, eye, or respiratory protection).",
        [
            "Head, eye, hand, and foot protection must match the site rules and task risk.",
            "Replace damaged PPE immediately; do not tape or modify structural parts of helmets.",
            "Hi-vis must be clean and visible; reflective strips effective in low light.",
        ],
        ["Hard hat", "Safety boots", "Hi-vis", "Eye protection as required"],
    ),
    _tpl(
        "working_at_height",
        "Work at height",
        "Toolbox talk: Working at height",
        "Falls from height remain a critical risk. Every task needs a clear method, edge protection or fall-arrest where required, and rescue thinking before work starts.\n\n"
        "Confirm guardrails, toe boards, and access ladders are secure. Discuss weather and housekeeping that could affect balance or footing.",
        [
            "Only competent persons install, alter, or dismantle edge protection or harness systems.",
            "Tools and materials must be secured; nothing loose on open edges.",
            "Ladders are for light, short-duration work only when the risk assessment allows.",
        ],
        ["Hard hat", "Harness and lanyard where required", "Non-slip footwear"],
    ),
    _tpl(
        "slips_trips_falls",
        "Housekeeping",
        "Toolbox talk: Slips, trips and falls",
        "Most slips and trips are preventable with good housekeeping, lighting, and sensible pacing on site.\n\n"
        "Identify trailing cables, wet areas, and debris on access routes. Agree who clears issues as they appear.",
        [
            "Keep walkways and stair treads clear; cordon wet areas until dry or treated.",
            "Use three points of contact on stairs; no running on site.",
            "Report damaged treads, lighting, or covers immediately.",
        ],
        ["Safety footwear with good grip", "Hi-vis"],
    ),
    _tpl(
        "site_housekeeping",
        "Housekeeping",
        "Toolbox talk: Site housekeeping",
        "Good housekeeping reduces fire load, trip hazards, and struck-by incidents. It also makes emergency access faster.\n\n"
        "Assign zones if needed so everyone knows expectations for waste, materials, and tools at end of break.",
        [
            "Waste in bins or skips; segregate where the site waste plan requires.",
            "Materials stacked stable and within safe height limits.",
            "Tools returned after use; no items left on access routes.",
        ],
        ["Gloves", "Hi-vis", "Eye protection when cleaning dusty areas"],
    ),
    _tpl(
        "dust_and_silica",
        "Health",
        "Toolbox talk: Dust and silica",
        "Dust from cutting, chasing, and demolition can cause serious long-term lung disease. Water suppression, extraction, and RPE where required are essential.\n\n"
        "Review today's cutting or breakout tasks and confirm controls are in place before starting.",
        [
            "Use on-tool extraction or water suppression as per the assessment.",
            "RPE must be face-fit tested and suitable for the hazard; disposable masks alone may be insufficient.",
            "Clean down with class M/H vacuum systems, not dry brushing.",
        ],
        ["FFP3 or assigned RPE where required", "Eye protection", "Gloves"],
    ),
    _tpl(
        "fire_safety",
        "Emergency",
        "Toolbox talk: Fire safety",
        "Hot work, accumulations of combustible waste, and blocked exits increase fire risk. Everyone should know alarms, assembly points, and extinguishers for their area.\n\n"
        "Confirm today's hot work permits (if any) and that extinguishers and exits are unobstructed.",
        [
            "No hot work without permit and fire watch where the site rules require it.",
            "Keep fire exits and extinguishers clear at all times.",
            "Raise the alarm early; do not fight fire beyond your training.",
        ],
        ["Hi-vis", "Eye protection for hot work"],
    ),
    _tpl(
        "electrical_safety",
        "Energy",
        "Toolbox talk: Electrical safety",
        "Damaged leads, overloaded boards, and unauthorised alterations cause shocks and fires. Only competent persons work on live systems.\n\n"
        "Inspect extension reels and 110V supplies before use; report damage immediately.",
        [
            "Assume equipment is live until proven isolated.",
            "Use RCD protection where portable supplies are used outdoors or in wet areas.",
            "Do not bypass guards or interlocks on tools or plant.",
        ],
        ["Insulated tools where specified", "Safety footwear"],
    ),
    _tpl(
        "plant_and_machinery",
        "Plant",
        "Toolbox talk: Plant and machinery",
        "Plant movements create crush and strike risks. Banksmen, exclusion zones, and clear communication prevent incidents.\n\n"
        "Review blind spots, slewing zones, and pedestrian/plant segregation for today's lifts or moves.",
        [
            "Exclusion zones respected; no walking under suspended loads.",
            "Banksman signals agreed and visible; stop if communication fails.",
            "Pre-start checks completed; defects reported before use.",
        ],
        ["Hi-vis", "Hard hat", "Safety boots", "Hearing protection near running plant"],
    ),
    _tpl(
        "vehicle_movements",
        "Logistics",
        "Toolbox talk: Vehicle movements",
        "Deliveries and plant movements need clear routes, signage, and awareness of reversing vehicles.\n\n"
        "Confirm one-way systems, marshalling, and pedestrian gates for the shift.",
        [
            "High-vis must be worn where vehicles operate.",
            "Never walk behind a reversing vehicle without positive acknowledgement from the driver.",
            "Seatbelts worn on all site transport where fitted.",
        ],
        ["Hi-vis", "Hard hat if site rules require in vehicle areas"],
    ),
    _tpl(
        "hot_works",
        "Hot work",
        "Toolbox talk: Hot works",
        "Hot work can ignite hidden combustibles. Permits, fire watch, and post-work checks are standard controls.\n\n"
        "Confirm duration, adjacent combustibles, and extinguisher type before striking an arc or using burners.",
        [
            "Permit to work in place; 60-minute (or site-defined) fire watch after completion.",
            "Fire blanket and extinguishers suitable for the fuel class present.",
            "Gas bottles stored upright, secured, and away from heat sources when not in use.",
        ],
        ["Fire-retardant overalls where specified", "Eye/face protection", "Gloves"],
    ),
    _tpl(
        "coshh_hazardous_substances",
        "COSHH",
        "Toolbox talk: COSHH / hazardous substances",
        "Substances used on site may be irritants, sensitisers, or harmful if inhaled. SDS information and safe systems of work must be followed.\n\n"
        "Review today's products, dilution rates, and disposal routes for empty containers.",
        [
            "Use the smallest quantity needed for the task; decant in ventilated areas where required.",
            "Correct gloves and eye protection for the chemical class.",
            "Wash hands before eating; do not use solvents to clean skin.",
        ],
        ["Chemical-resistant gloves", "Eye protection", "RPE where assessment requires"],
    ),
    _tpl(
        "emergency_procedures",
        "Emergency",
        "Toolbox talk: Emergency procedures",
        "Everyone must know how to raise an alarm, where to assemble, and who is the first point of contact on site.\n\n"
        "Reconfirm assembly point, muster roles, and nearest first-aid provision for this work area.",
        [
            "Report all injuries and near misses promptly; first aid is not a substitute for medical care when needed.",
            "Do not re-enter buildings until authorised after an alarm.",
            "Know the location of nearest telephone or radio channel for emergency calls.",
        ],
        ["Hi-vis", "Hard hat as site rules require"],
    ),
]


def list_topic_template_dicts() -> list[dict[str, Any]]:
    return [dict(t) for t in TOOLBOX_TOPIC_TEMPLATES]


def get_topic_template_dict(topic: str) -> dict[str, Any] | None:
    for t in TOOLBOX_TOPIC_TEMPLATES:
        if t["topic"] == topic:
            return dict(t)
    return None
