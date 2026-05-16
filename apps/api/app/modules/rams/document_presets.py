"""Professional RAMS document presets (static, v1 — no external APIs)."""

from __future__ import annotations

from typing import Any, TypedDict


class _HazardSeed(TypedDict):
    hazard: str
    who_might_be_harmed: str
    initial_likelihood: int
    initial_severity: int
    control_measures: str
    residual_likelihood: int
    residual_severity: int


class _RamsPresetExtras(TypedDict, total=False):
    mandatory_gloves: list[str]
    pre_start_checklist: list[str]
    sequence_of_works: list[dict[str, Any]]
    plant_tools: list[str]
    training_requirements: list[str]
    coshh_items: list[str]
    glove_requirements: list[str]
    method_statement_sections: list[dict[str, Any]]


class RamsDocumentPresetDict(_RamsPresetExtras):
    id: str
    title: str
    work_activity: str
    description: str
    risk_level: str
    ppe: list[str]
    hazards: list[_HazardSeed]


def _h(
    hazard: str,
    harmed: str,
    il: int,
    is_: int,
    controls: str,
    rl: int,
    rs: int,
) -> _HazardSeed:
    return {
        "hazard": hazard,
        "who_might_be_harmed": harmed,
        "initial_likelihood": il,
        "initial_severity": is_,
        "control_measures": controls,
        "residual_likelihood": rl,
        "residual_severity": rs,
    }


RAMS_DOCUMENT_PRESETS: list[RamsDocumentPresetDict] = [
    {
        "id": "brickwork_masonry",
        "title": "RAMS — Brickwork / blockwork (professional preset)",
        "work_activity": "Brick and block walling, mortar works, pointing, cutting, loading/unloading, and associated tasks.",
        "description": "Professional pack starter for masonry trades: deliveries, access, dust, plant, COSHH interfaces, and public protection.",
        "risk_level": "medium",
        "ppe": [
            "Hard hat",
            "Hi-vis vest/jacket",
            "Safety boots",
            "Eye protection",
            "Hearing protection (when cutting)",
            "Dust mask / RPE as assessment requires",
            "Gloves (task-specific)",
        ],
        "mandatory_gloves": ["Mortar/cement handling gloves", "Cut-resistant when using clipper saw"],
        "pre_start_checklist": [
            "Access / low-level platform or scaffold inspected and tagged if required",
            "Exclusion zones and public interface reviewed",
            "Plant and LEV / water suppression available for cutting",
            "Delivery route and reversing control in place",
        ],
        "sequence_of_works": [
            {"step": 1, "text": "Deliver and stack materials; use banksman and segregation for vehicle movements."},
            {"step": 2, "text": "Set out, datum, and openings; secure materials against weather and wind."},
            {"step": 3, "text": "Build sequence with mortar management; control dust at cutting/chasing points."},
            {"step": 4, "text": "Housekeeping, waste routes, and end-of-shift tidy."},
        ],
        "plant_tools": ["Mixer", "Cut-off / clipper saw", "110V or cordless tools", "FLT / telehandler as planned"],
        "training_requirements": [
            "Manual handling",
            "Low-level access / safe stand",
            "Abrasive wheels if cutting",
            "Dust / silica awareness",
        ],
        "coshh_items": ["Cement / mortar", "Plasticiser", "Mastics / sealants", "Cutting fluids as applicable"],
        "glove_requirements": ["Correct glove for wet mortar vs mechanical cut risks"],
        "method_statement_sections": [
            {"title": "Setting out", "body": "Confirm grid, datum, tolerances, and structural openings before build."},
            {"title": "Housekeeping", "body": "Maintain clear walkways; secure pallets; sweep and suppress dust."},
        ],
        "hazards": [
            _h(
                "Manual handling of blocks and mortar boards",
                "Bricklayers, labourers",
                4,
                3,
                "Mechanical aids where practicable; team lifts for heavy units; tidy stacks; rotate tasks; training in safe handling.",
                2,
                2,
            ),
            _h(
                "Falling materials or tools from height",
                "Operatives and pedestrians below",
                3,
                4,
                "Toe boards and brick guards; exclusion zones; tool tethering; keep working area tidy.",
                2,
                3,
            ),
            _h(
                "Dust from cutting blocks or chasing",
                "Operatives, others nearby",
                3,
                3,
                "On-tool extraction where available; water suppression; RPE where assessment requires; limit duration of cutting.",
                2,
                2,
            ),
            _h(
                "Working at height / working platforms",
                "Operatives, others below",
                4,
                4,
                "Suitable low-level access; guardrails where required; materials secured; rescue plan for MEWP if used.",
                2,
                3,
            ),
            _h(
                "Failure of lifting plant / unloading palletised materials",
                "Operatives, vehicle crew",
                3,
                4,
                "Exclusion zone; competent slinger; check SWL; stable stacking; damaged pallets rejected.",
                2,
                2,
            ),
            _h(
                "Dropped loads / unstable pallets",
                "Operatives, pedestrians",
                3,
                3,
                "Flat ground; banding; limit stack height; segregate pedestrians; inspect forks and telehandler.",
                2,
                2,
            ),
            _h(
                "Collision with reversing vehicles / plant",
                "All on site",
                4,
                4,
                "Banksman; reversing alarms; one-way systems; hi-vis; mirrors and cameras where fitted.",
                2,
                3,
            ),
            _h(
                "HAVS from vibrating tools",
                "Tool users",
                3,
                3,
                "Right tool for task; trigger-time limits; maintenance; warm-up breaks; anti-vibration gloves if suitable.",
                2,
                2,
            ),
            _h(
                "110V / cordless power tools",
                "Operatives",
                3,
                3,
                "PAT / inspection regime; RCD protection; correct cables; battery charging in safe area only.",
                2,
                2,
            ),
            _h(
                "Clipper saw operation",
                "Operator, bystanders",
                3,
                4,
                "Abrasive wheels training; guard in place; exclusion; eye/hearing protection; blade condition checks.",
                2,
                2,
            ),
            _h(
                "COSHH — cement / plasticiser / mastic",
                "Operatives",
                3,
                3,
                "Follow SDS; avoid skin contact; wash facilities; substitution where possible; spill kits.",
                2,
                2,
            ),
            _h(
                "Weather conditions",
                "Operatives",
                2,
                3,
                "Wind/rain plan; stop exposed work if unsafe; secure lightweight materials; improve footing.",
                1,
                2,
            ),
            _h(
                "Public interface / exclusion zones",
                "Public, operatives",
                3,
                4,
                "Heras fencing; signage; controlled gates; deliveries out of peak; marshal public interface.",
                2,
                2,
            ),
        ],
    },
    {
        "id": "general_construction",
        "title": "RAMS — General construction works",
        "work_activity": "General site construction activities including deliveries, movement of plant, and multi-trade interfaces.",
        "description": "Baseline RAMS for mixed trades on a live construction site with vehicle and pedestrian interface.",
        "risk_level": "medium",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Gloves", "Eye protection"],
        "hazards": [
            _h(
                "Vehicle / plant interface with pedestrians",
                "All site personnel, visitors",
                4,
                4,
                "Segregated walkways; banksman where required; speed limits; reversing aids; induction on traffic management.",
                2,
                3,
            ),
            _h(
                "Slips, trips and falls on site",
                "All operatives",
                3,
                3,
                "Good housekeeping; lighting; clear waste routes; report defects; keep cables managed.",
                2,
                2,
            ),
            _h(
                "Unauthorised access to work area",
                "Public, untrained workers",
                2,
                3,
                "Secure site perimeter; controlled gates; signage; permit-to-dig / hot work where relevant.",
                1,
                2,
            ),
        ],
    },
    {
        "id": "working_at_height",
        "title": "RAMS — Working at height",
        "work_activity": "Tasks where a fall could cause injury, including ladders, towers, MEWPs, and leading-edge work.",
        "description": "Focus on fall prevention, collective protection first, and rescue considerations for planned work at height.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Harness / fall arrest", "Gloves"],
        "hazards": [
            _h(
                "Falls from edges, platforms, or incomplete structures",
                "Operatives, others below",
                4,
                5,
                "Prefer collective protection; guardrails; nets where specified; harness with suitable anchor if required; rescue plan.",
                2,
                3,
            ),
            _h(
                "Falling tools and materials",
                "Persons below",
                3,
                4,
                "Tool lanyards; toe boards; debris netting; exclusion zones; barricades.",
                2,
                2,
            ),
            _h(
                "Ladder / tower misuse",
                "Operative using access equipment",
                3,
                3,
                "Competent erection and inspection; correct class of ladder; tie off; stable ground; do not overreach.",
                2,
                2,
            ),
        ],
    },
    {
        "id": "manual_handling",
        "title": "RAMS — Manual handling",
        "work_activity": "Lifting, lowering, pushing, pulling and carrying loads by hand or with basic aids.",
        "description": "Reduce musculoskeletal injury risk through design, mechanical aids, and team handling where loads cannot be avoided.",
        "risk_level": "medium",
        "ppe": ["Safety boots", "Gloves", "Hi-vis vest/jacket"],
        "hazards": [
            _h(
                "Heavy or awkward loads",
                "Operatives involved in lift",
                4,
                3,
                "Eliminate lifts where possible; mechanical aids; reduce carry distances; team lifts with agreed signals; training.",
                2,
                2,
            ),
            _h(
                "Repetitive handling",
                "Operatives",
                3,
                3,
                "Job rotation; micro-pauses; workstation layout; task variety.",
                2,
                2,
            ),
        ],
    },
    {
        "id": "cutting_grinding_dust",
        "title": "RAMS — Cutting / grinding / dust",
        "work_activity": "Stone, concrete, or masonry cutting and grinding producing dust and projectiles.",
        "description": "Control inhalation and explosion risks from dust; protect eyes from high-speed particles.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Safety boots", "Eye protection", "Hearing protection", "Respiratory protection", "Hi-vis vest/jacket"],
        "hazards": [
            _h(
                "Respirable dust including silica",
                "Operatives, nearby workers",
                4,
                4,
                "LEV / on-tool extraction; water suppression; RPE to site standard; minimise dry cutting duration.",
                2,
                3,
            ),
            _h(
                "Flying particles from discs or blades",
                "Operatives, bystanders",
                3,
                4,
                "Screening; exclusion zone; correct disc type and guard; inspect tools before use.",
                2,
                2,
            ),
        ],
    },
    {
        "id": "scaffold_access",
        "title": "RAMS — Scaffold / access platform work",
        "work_activity": "Use of scaffold systems, tower scaffolds, and mobile elevating work platforms for access.",
        "description": "Ensure access equipment is suitable, inspected, and used only by trained operatives.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Harness / fall arrest", "Gloves"],
        "hazards": [
            _h(
                "Incomplete or defective scaffold",
                "Operatives on scaffold",
                3,
                5,
                "Handover tags; weekly inspections; do not remove ties; report defects; follow TG20/system guidance.",
                2,
                3,
            ),
            _h(
                "Falls during erection/dismantling",
                "Scaffold team",
                4,
                4,
                "Method statement; harness where required; exclusion zones; competent supervision.",
                2,
                3,
            ),
        ],
    },
    {
        "id": "excavation_groundworks",
        "title": "RAMS — Excavation / groundworks",
        "work_activity": "Trial holes, trenches, and bulk excavation including support and services location.",
        "description": "Prevent collapse, contact with underground services, and water ingress.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Safety boots", "Hi-vis vest/jacket", "Gloves"],
        "hazards": [
            _h(
                "Trench or excavation collapse",
                "Operatives in excavation",
                4,
                5,
                "Battering or support systems; competent engineer input where required; daily inspection; no surcharges at edge.",
                2,
                3,
            ),
            _h(
                "Striking underground services",
                "Operatives and public",
                3,
                5,
                "Service searches; permit to dig; hand dig zones; lock off where applicable; emergency contact details on site.",
                2,
                3,
            ),
        ],
    },
    {
        "id": "plant_machinery",
        "title": "RAMS — Plant and machinery",
        "work_activity": "Operation of excavators, dumpers, telehandlers, and other mobile plant on site.",
        "description": "Segregation, competence, and maintenance controls for mobile plant operations.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Hearing protection"],
        "hazards": [
            _h(
                "Struck by moving plant",
                "Pedestrians and operatives",
                5,
                4,
                "Exclusion zones; banksman; cameras/aided vision; plant/pedestrian routes separated; audible alarms.",
                2,
                3,
            ),
            _h(
                "Plant overturning or instability",
                "Operator and others",
                3,
                4,
                "Ground assessment; outriggers; load charts; competent operators; speed limits.",
                2,
                2,
            ),
        ],
    },
    {
        "id": "hot_works",
        "title": "RAMS — Hot works",
        "work_activity": "Welding, grinding that generates sparks, gas cutting, and other ignition sources.",
        "description": "Control ignition of combustibles and provision for fire watch where required.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Safety boots", "Gloves", "Eye protection", "Hi-vis vest/jacket"],
        "hazards": [
            _h(
                "Fire from hot work in combustible environment",
                "All on site",
                4,
                5,
                "Hot work permit; remove/combustibles shield; fire extinguisher; fire watch; post-work inspection.",
                2,
                3,
            ),
            _h(
                "Fumes and metal fume",
                "Operatives",
                3,
                3,
                "LEV where practicable; RPE if assessment requires; ventilation; rotate tasks.",
                2,
                2,
            ),
        ],
    },
    {
        "id": "coshh_substances",
        "title": "RAMS — COSHH / hazardous substances",
        "work_activity": "Use, storage, and disposal of hazardous substances including paints, solvents, adhesives, and cementitious products.",
        "description": "Follow SDS, substitution hierarchy, and local rules for storage and spill response.",
        "risk_level": "medium",
        "ppe": ["Safety boots", "Gloves", "Eye protection", "Respiratory protection", "Hi-vis vest/jacket"],
        "hazards": [
            _h(
                "Skin or respiratory exposure",
                "Operatives",
                3,
                4,
                "Substitution; engineering controls; RPE where required; training; washing facilities.",
                2,
                2,
            ),
            _h(
                "Spills and environmental release",
                "Operatives, environment",
                2,
                3,
                "Bunded storage; spill kits; correct containers; trained response; report significant spills per procedure.",
                1,
                2,
            ),
        ],
    },
    {
        "id": "concrete_works",
        "title": "RAMS — Concrete works",
        "work_activity": "Concrete pours, placing, compacting, finishing, curing, washout, and associated deliveries.",
        "description": "Template must be reviewed and adapted by a competent person for the pour size, access, plant, and site conditions.",
        "risk_level": "medium",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Eye protection", "Waterproof gloves"],
        "pre_start_checklist": ["Pour plan briefed", "Washout area agreed", "Exclusion zones set", "Emergency wash facilities available"],
        "sequence_of_works": [{"step": 1, "text": "Prepare access, formwork checks, and concrete delivery route."}, {"step": 2, "text": "Place, compact, finish, cure, clean down, and manage washout."}],
        "hazards": [
            _h("Wet concrete burns / dermatitis", "Operatives", 3, 4, "Impervious gloves/boots; avoid skin contact; wash facilities; remove contaminated clothing promptly.", 2, 2),
            _h("Concrete wagon / pump movements", "Operatives, public", 4, 4, "Banksman; segregated route; exclusion zone around pump; competent operator and communication.", 2, 3),
            _h("Manual handling of equipment", "Operatives", 3, 3, "Mechanical aids; team handling; plan hose movements; rotate tasks.", 2, 2),
        ],
    },
    {
        "id": "roofing_works",
        "title": "RAMS — Roofing works",
        "work_activity": "Roof covering, repairs, edge work, material loading, weatherproofing, and associated access.",
        "description": "Professional template based on UK construction safety practice; review edge protection, fragile surfaces, and rescue arrangements.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Gloves", "Harness where specified"],
        "pre_start_checklist": ["Fragile surfaces identified", "Edge protection inspected", "Weather checked", "Rescue arrangements briefed"],
        "hazards": [
            _h("Falls from roof edge or openings", "Operatives, others below", 4, 5, "Collective edge protection; covers; safe access; exclusion zone; fall protection only where planned.", 2, 3),
            _h("Fragile roof surfaces", "Operatives", 4, 5, "Survey; crawling boards or platform; signage; no stepping on unprotected fragile materials.", 2, 3),
            _h("Materials falling from height", "Persons below", 3, 4, "Toe boards; controlled lifting; exclusion zones; secure materials against wind.", 2, 2),
        ],
    },
    {
        "id": "demolition_stripout",
        "title": "RAMS — Demolition / strip-out",
        "work_activity": "Soft strip, non-structural demolition, waste removal, service isolation, and making safe.",
        "description": "Template starter only. Confirm surveys, isolations, structural limits, and waste routes before publishing.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Gloves", "Eye protection", "RPE as required"],
        "pre_start_checklist": ["Asbestos/service surveys reviewed", "Services isolated", "Waste route agreed", "Exclusion zones in place"],
        "hazards": [
            _h("Unidentified services or hazardous materials", "Operatives, building users", 3, 5, "Review surveys; isolate services; stop work if suspect material found; competent supervision.", 1, 3),
            _h("Falling debris / unstable elements", "Operatives, others nearby", 4, 4, "Sequence works; exclusion zones; do not undermine supports; controlled removal.", 2, 3),
            _h("Dust and noise", "Operatives, neighbours", 4, 3, "Suppression; extraction; RPE/hearing protection; monitor and restrict exposure.", 2, 2),
        ],
    },
    {
        "id": "electrical_works",
        "title": "RAMS — Electrical works",
        "work_activity": "Electrical installation, isolation, testing, containment, cabling, and commissioning support.",
        "description": "A competent electrical person must review isolations, permits, testing arrangements, and live-work controls.",
        "risk_level": "high",
        "ppe": ["Safety boots", "Hi-vis vest/jacket", "Insulated tools/PPE as specified", "Eye protection"],
        "pre_start_checklist": ["Isolation confirmed", "Lock-off/tag-out in place", "Test equipment calibrated", "Permit reviewed where required"],
        "hazards": [
            _h("Electric shock / arc flash", "Electricians, others nearby", 3, 5, "Isolate, lock off, prove dead; live work only by permit and justified method; competent workers.", 1, 3),
            _h("Working at height for containment/cabling", "Operatives", 3, 4, "Suitable access; inspect towers/ladders; avoid overreach; secure tools.", 2, 2),
            _h("Trip hazards from temporary leads", "All site personnel", 3, 2, "Cable management; routes protected; battery tools where practical; housekeeping.", 1, 2),
        ],
    },
    {
        "id": "plumbing_hot_works",
        "title": "RAMS — Plumbing / hot works",
        "work_activity": "Pipework installation, soldering/brazing, pressure testing, drainage alterations, and local hot works.",
        "description": "Review permits, isolations, pressure testing limits, and fire watch requirements before publishing.",
        "risk_level": "medium",
        "ppe": ["Safety boots", "Gloves", "Eye protection", "Hi-vis vest/jacket"],
        "hazards": [
            _h("Fire from soldering or brazing", "Operatives, property", 3, 5, "Hot work permit; remove combustibles; fire extinguisher; fire watch and post-work check.", 1, 3),
            _h("Water escape / pressure release", "Operatives, property", 3, 3, "Isolate and drain; controlled pressure testing; barriers; competent supervision.", 1, 2),
            _h("Manual handling of pipes and cylinders", "Operatives", 3, 3, "Mechanical aids; cap cylinders; secure storage; team lift long lengths.", 2, 2),
        ],
    },
    {
        "id": "painting_decorating",
        "title": "RAMS — Painting / decorating",
        "work_activity": "Preparation, sanding, painting, coatings, minor filling, and use of access equipment.",
        "description": "Adapt for coatings, ventilation, COSHH, access, and occupancy interfaces.",
        "risk_level": "medium",
        "ppe": ["Safety boots", "Gloves", "Eye protection", "RPE as assessment requires"],
        "hazards": [
            _h("COSHH exposure to paints/solvents", "Operatives, occupants", 3, 3, "Use low-VOC products where possible; ventilation; SDS briefing; gloves/RPE as required.", 1, 2),
            _h("Dust from sanding/preparation", "Operatives, others nearby", 3, 3, "Dust extraction; wet methods where suitable; RPE; segregate work area.", 2, 2),
            _h("Falls from steps/towers", "Operatives", 3, 3, "Suitable access; avoid overreach; inspect access; keep floors clear.", 1, 2),
        ],
    },
    {
        "id": "carpentry_joinery",
        "title": "RAMS — Carpentry / joinery",
        "work_activity": "First and second fix carpentry, cutting, fixing, installation, and material handling.",
        "description": "Review tool guarding, dust control, manual handling, fire stopping, and access before publishing.",
        "risk_level": "medium",
        "ppe": ["Hard hat", "Safety boots", "Eye protection", "Hearing protection", "Gloves"],
        "hazards": [
            _h("Cuts from saws and sharp tools", "Carpenters, assistants", 3, 4, "Guards fitted; competent users; secure workpiece; cut-resistant gloves where suitable.", 1, 2),
            _h("Wood dust exposure", "Operatives, others nearby", 3, 3, "On-tool extraction; RPE; housekeeping; avoid dry sweeping.", 2, 2),
            _h("Manual handling of boards/doors", "Operatives", 4, 3, "Team lifts; trolleys; plan routes; store materials safely.", 2, 2),
        ],
    },
    {
        "id": "lifting_operations",
        "title": "RAMS — Lifting operations",
        "work_activity": "Mechanical lifting, slinging, signalling, load movement, exclusion zones, and landing operations.",
        "description": "This template does not replace a lift plan. A competent person must review equipment, loads, and ground conditions.",
        "risk_level": "high",
        "ppe": ["Hard hat", "Hi-vis vest/jacket", "Safety boots", "Gloves"],
        "hazards": [
            _h("Dropped or unstable load", "Operatives, public", 3, 5, "Lift plan; certified accessories; competent slinger/signaller; exclusion zone; check load weight and centre.", 1, 3),
            _h("Crush injury during landing", "Slingers, installers", 3, 4, "Hands clear; tag lines; agreed signals; stable landing area; no standing under suspended loads.", 1, 2),
            _h("Plant overturn / ground failure", "Operators, nearby persons", 2, 5, "Ground assessment; outrigger mats; safe working radius; weather limits.", 1, 3),
        ],
    },
    {
        "id": "roadworks_traffic_management",
        "title": "RAMS — Roadworks / traffic management",
        "work_activity": "Temporary traffic management, road or footway works, barriers, signage, and public interface.",
        "description": "Review permits, traffic management drawings, pedestrian routes, and emergency access before publishing.",
        "risk_level": "high",
        "ppe": ["Hi-vis class as required", "Safety boots", "Hard hat", "Gloves"],
        "hazards": [
            _h("Vehicle strike", "Operatives, public", 4, 5, "Approved traffic management; barriers; signage; safe zones; competent operatives.", 2, 3),
            _h("Public interface / pedestrians", "Public, operatives", 3, 4, "Clear pedestrian routes; ramps; lighting; marshal where needed; inspect barriers.", 1, 2),
            _h("Night/poor visibility work", "All involved", 3, 4, "Lighting; hi-vis; communication; reduce exposure time; weather monitoring.", 2, 2),
        ],
    },
    {
        "id": "cleaning_welfare_maintenance",
        "title": "RAMS — Cleaning / welfare maintenance",
        "work_activity": "Cleaning site welfare, offices, walkways, spill response, waste movement, and routine maintenance.",
        "description": "Adapt for substances used, waste streams, lone working, and public/site interfaces.",
        "risk_level": "low",
        "ppe": ["Safety footwear", "Gloves", "Eye protection as required", "Hi-vis vest/jacket"],
        "hazards": [
            _h("Slips from wet floors or spills", "Cleaners, site users", 3, 3, "Warning signs; dry routes; clean spills promptly; suitable footwear.", 1, 2),
            _h("COSHH exposure to cleaning products", "Cleaners, others nearby", 3, 3, "SDS available; correct dilution; labelled containers; gloves/eye protection as required.", 1, 2),
            _h("Waste handling / sharps", "Cleaners, operatives", 2, 4, "Segregate waste; use tools/gloves; report sharps; do not compress unknown waste by hand.", 1, 2),
        ],
    },
]


def get_document_preset_by_id(preset_id: str) -> RamsDocumentPresetDict | None:
    for p in RAMS_DOCUMENT_PRESETS:
        if p["id"] == preset_id:
            return p
    return None


def document_preset_public(p: RamsDocumentPresetDict) -> dict[str, Any]:
    """Subset safe for API list (full hazards for preview in v1)."""
    out: dict[str, Any] = {
        "id": p["id"],
        "title": p["title"],
        "work_activity": p["work_activity"],
        "description": p["description"],
        "risk_level": p["risk_level"],
        "ppe": list(p["ppe"]),
        "hazards": [dict(h) for h in p["hazards"]],
        "hazard_count": len(p["hazards"]),
    }
    for key in (
        "mandatory_gloves",
        "pre_start_checklist",
        "sequence_of_works",
        "plant_tools",
        "training_requirements",
        "coshh_items",
        "glove_requirements",
        "method_statement_sections",
    ):
        if key in p and p[key] is not None:  # type: ignore[index]
            out[key] = p[key]  # type: ignore[index]
    return out
