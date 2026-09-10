"""Buffered sensor snapshots; adapters perform no blocking device/network I/O."""
from abc import ABC, abstractmethod
from typing import Literal

from pydantic import Field

from backend.control.models import DataSource
from backend.models import Model, Signals

FieldSource = Literal["simulated", "external", "phone_ppg", "apple_watch", "unknown"]


class FieldSources(Model):
    heart_rate: FieldSource
    resp_rate: FieldSource


class SensorReading(Model):
    timestamp: float = Field(ge=0)
    heart_rate: float | None = Field(default=None, gt=0)
    resp_rate: float | None = Field(default=None, gt=0)
    field_sources: FieldSources
    stale_reason: str | None = None


class SignalFrame(SensorReading):
    """Complete, stable input contract immediately before State Engine."""
    heart_rate: float = Field(gt=0)
    resp_rate: float = Field(gt=0)

    def signals(self) -> Signals:
        return Signals(heart_rate=self.heart_rate, resp_rate=self.resp_rate)

    @property
    def data_source(self) -> DataSource:
        sources = set(self.field_sources.model_dump().values())
        if "unknown" in sources:
            return "unknown"
        if sources == {"simulated"}:
            return "simulated"
        if sources <= {"external", "phone_ppg", "apple_watch"}:
            return "sensor"
        return "mixed"


class SensorAdapter(ABC):
    @abstractmethod
    def read(self, second: int, timestamp: float, *, now: float | None = None) -> SensorReading:
        """Read a nonblocking buffer at a session tick; timestamp is its sample time.

        now is the freshness evaluation time (can be later during catch-up).
        Future hardware producers should fill buffers asynchronously.
        """
