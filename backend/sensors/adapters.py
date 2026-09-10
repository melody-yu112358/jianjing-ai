"""Simulator wrapper and field-wise composition; simulator math is unchanged."""
from backend.sensors.base import FieldSources, SensorAdapter, SignalFrame
from backend.sensors.simulator import Simulator


class SimulatorAdapter(SensorAdapter):
    def __init__(self, simulator: Simulator):
        self.simulator = simulator

    def read(self, second: int, timestamp: float, *, now: float | None = None) -> SignalFrame:
        return SignalFrame(timestamp=timestamp, **self.simulator.sample(second).model_dump(),
                           field_sources=FieldSources(heart_rate="simulated", resp_rate="simulated"))


class MixedAdapter(SensorAdapter):
    def __init__(self, simulator: SimulatorAdapter, external: SensorAdapter):
        self.simulator, self.external = simulator, external

    def read(self, second: int, timestamp: float, *, now: float | None = None) -> SignalFrame:
        simulated = self.simulator.read(second, timestamp, now=now)
        external = self.external.read(second, timestamp, now=now)
        if external.heart_rate is None:
            return simulated.model_copy(update={"stale_reason": external.stale_reason})
        return SignalFrame(timestamp=timestamp, heart_rate=external.heart_rate, resp_rate=simulated.resp_rate,
            field_sources=FieldSources(heart_rate=external.field_sources.heart_rate, resp_rate="simulated"))
