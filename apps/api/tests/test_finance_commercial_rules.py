from decimal import Decimal

from app.modules.finance.commercial_service import retention_withheld_for


def test_retention_is_five_percent_of_certified_net() -> None:
    assert retention_withheld_for(Decimal("10000.0000"), Decimal("5.0000")) == Decimal("500.0000")
    assert retention_withheld_for(Decimal("100.0000"), Decimal("0.0000")) == Decimal("0.0000")
