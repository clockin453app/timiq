"""Late / unpaid shift detection after payroll is marked paid (v1 heuristic, no shift-line table)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.modules.payroll.models import PayrollItem
from app.modules.time_clock.models import TimeShift

TIMIQ_LATE_SHIFT_IDS_MARKER = "timiq:late_shift_ids:"


def shift_completed_after_paid_cutoff(shift: TimeShift, paid_cutoff: datetime) -> bool:
    """True if shift is completed and work finishing (or last update) is strictly after paid_cutoff."""
    if shift.status != "completed":
        return False
    pc = paid_cutoff if paid_cutoff.tzinfo else paid_cutoff.replace(tzinfo=timezone.utc)
    if shift.clock_out_at is not None:
        co = shift.clock_out_at
        if co.tzinfo is None:
            co = co.replace(tzinfo=timezone.utc)
        return co > pc
    up = shift.updated_at
    if up.tzinfo is None:
        up = up.replace(tzinfo=timezone.utc)
    return up > pc


def parse_late_shift_ids_from_notes(notes: str | None) -> set[uuid.UUID]:
    if not notes:
        return set()
    out: set[uuid.UUID] = set()
    for line in notes.split("\n"):
        line = line.strip()
        if not line.startswith(TIMIQ_LATE_SHIFT_IDS_MARKER):
            continue
        raw = line[len(TIMIQ_LATE_SHIFT_IDS_MARKER) :].strip()
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                out.add(uuid.UUID(part))
            except ValueError:
                continue
    return out


def reserved_late_shift_ids_for_user_period(items: list[PayrollItem], user_id: uuid.UUID) -> set[uuid.UUID]:
    """Shift IDs already allocated to a pending adjustment row for this user in the period."""
    reserved: set[uuid.UUID] = set()
    for it in items:
        if it.user_id != user_id or it.status != "pending":
            continue
        reserved |= parse_late_shift_ids_from_notes(it.notes)
    return reserved


def append_late_shift_ids_marker(notes: str, shift_ids: list[uuid.UUID]) -> str:
    base = (notes or "").rstrip()
    line = f"{TIMIQ_LATE_SHIFT_IDS_MARKER}{','.join(str(x) for x in shift_ids)}"
    if not base:
        return line
    return f"{base}\n{line}"
