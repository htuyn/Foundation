import pytest

from app.core.errors import ApiError
from app.services.scanner_rate_limit import ScannerRateLimiter


def test_scanner_rate_limiter_rejects_requests_over_window_limit() -> None:
    limiter = ScannerRateLimiter()
    limiter.check("device:one", limit=1, window_seconds=60)

    with pytest.raises(ApiError) as error:
        limiter.check("device:one", limit=1, window_seconds=60)

    assert error.value.status_code == 429
    assert error.value.code == "SCANNER_RATE_LIMITED"
