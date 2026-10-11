from collections import defaultdict
from threading import Lock
from time import monotonic

from app.core.errors import ApiError


class ScannerRateLimiter:
    def __init__(self) -> None:
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            if len(self._requests) > 4096:
                self._requests = defaultdict(
                    list,
                    {item: [timestamp for timestamp in times if timestamp > cutoff]
                     for item, times in self._requests.items()
                     if any(timestamp > cutoff for timestamp in times)},
                )
            recent = [timestamp for timestamp in self._requests[key] if timestamp > cutoff]
            if len(recent) >= limit:
                self._requests[key] = recent
                raise ApiError(429, "SCANNER_RATE_LIMITED", "Quá nhiều yêu cầu scanner. Hãy đợi rồi thử lại.")
            recent.append(now)
            self._requests[key] = recent


scanner_rate_limiter = ScannerRateLimiter()
