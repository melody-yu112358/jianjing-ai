"""Native-bridge integration point only; does not connect to Apple devices."""
from backend.sensors.external import ExternalHeartRateAdapter, HeartRateInput, InputRejected


class AppleWatchHeartRateAdapter(ExternalHeartRateAdapter):
    def accept(self, value: HeartRateInput):
        if value.source != "apple_watch":
            raise InputRejected("apple_watch_source_required")
        super().accept(value)
