"""Identifiers for future read-only operational sources.

A source identity names an external record and a content hash. It stores no
amounts, does not read payroll or attendance, and is not a Finance payment.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum


class FinanceSourceKind(str, Enum):
    """External record families a later snapshot may cite."""

    CIS_PAYROLL_ITEM = "cis_payroll_item"
    PAYE_PAYROLL_ITEM = "paye_payroll_item"
    TIME_SHIFT = "time_shift"
    TIMESHEET_EXTRA_HOURS = "timesheet_extra_hours"


class FinanceSourceError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ExternalSourceIdentity:
    """Stable pointer to a future read-only source. Not a cash movement."""

    source_kind: FinanceSourceKind
    source_id: uuid.UUID
    source_hash: str


def external_source_identity(
    source_kind: FinanceSourceKind,
    source_id: uuid.UUID,
    source_hash: str,
) -> ExternalSourceIdentity:
    """Build a source pointer. The hash must be a non-empty fingerprint."""
    fingerprint = source_hash.strip()
    if fingerprint == "":
        raise FinanceSourceError("Source hash is required.")
    if not isinstance(source_kind, FinanceSourceKind):
        raise FinanceSourceError("Unknown finance source kind.")
    return ExternalSourceIdentity(
        source_kind=source_kind,
        source_id=source_id,
        source_hash=fingerprint,
    )
