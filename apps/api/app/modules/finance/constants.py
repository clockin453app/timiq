"""Foundational Finance identifiers.

Currency support and money storage scale only. VAT rates, CIS rates, cost
codes, and accountant-controlled tax policies are not defined here.
"""

from __future__ import annotations

# Initially supported currency. Other codes are rejected until a later phase.
SUPPORTED_CURRENCY_CODE = "GBP"

# Agreed PostgreSQL money scale for later NUMERIC columns. Not a display rate.
MONEY_STORAGE_PRECISION = 18
MONEY_STORAGE_SCALE = 4
