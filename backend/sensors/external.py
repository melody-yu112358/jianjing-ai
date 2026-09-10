"""Uncalibrated external HR input, freshness validation and session isolation."""
from dataclasses import dataclass
import math
import os
import time
from typing import Literal

from pydantic import Field, model_validator

from backend.models import Model
from backend.sensors.base import FieldSources, SensorAdapter, SensorReading


@dataclass(frozen=True)
class SensorSettings:
    mode: str = "simulated"
    ttl_sec: float = 5.0
    future_tolerance_sec: float = 2.0

    def __post_init__(self):
        if self.mode not in ("simulated", "mixed"):
            raise ValueError("SENSOR_MODE must be simulated or mixed")
        if not math.isfinite(self.ttl_sec) or not 0.5 <= self.ttl_sec <= 60:
            raise ValueError("EXTERNAL_HR_TTL_SEC must be between 0.5 and 60")
        if not math.isfinite(self.future_tolerance_sec) or not 0 <= self.future_tolerance_sec <= 5:
            raise ValueError("Future tolerance must be between 0 and 5 seconds")

    @classmethod
    def from_env(cls):
        return cls(mode=os.getenv("SENSOR_MODE", "simulated"),
                   ttl_sec=float(os.getenv("EXTERNAL_HR_TTL_SEC", "5")))


class HeartRateInput(Model):
    timestamp: float = Field(ge=0, strict=True)
    heart_rate: float = Field(ge=30, le=220, strict=True)
    session_id: str | None = Field(default=None, min_length=1, max_length=128)
    source: Literal["external", "phone_ppg", "apple_watch"] = "external"
    valid: bool = Field(default=True, strict=True)
    signal_quality: float | None = Field(default=None, ge=0, le=1, strict=True)
    duration_sec: float | None = Field(default=None, ge=0, le=60, strict=True)
    measurement_phase: Literal["pre", "post"] | None = None

    @model_validator(mode="after")
    def quality_gate(self):
        if not self.valid:
            raise ValueError("Invalid measurements cannot enter the HR buffer")
        if self.source == "phone_ppg":
            if self.signal_quality is None or self.signal_quality < 0.65:
                raise ValueError("phone_ppg requires signal_quality >= 0.65")
            if self.duration_sec is None or not 20 <= self.duration_sec <= 30.5:
                raise ValueError("phone_ppg requires a 20–30 second measurement")
            if not self.session_id or not self.measurement_phase or not 45 <= self.heart_rate <= 180:
                raise ValueError("phone_ppg requires session, phase and bounded BPM")
        return self


class InputRejected(ValueError):
    def __init__(self, reason: str, status_code: int = 422):
        self.reason, self.status_code = reason, status_code
        super().__init__(reason)


class ExternalHeartRateAdapter(SensorAdapter):
    def __init__(self, settings: SensorSettings, session_id: str, *, created_at: float,
                 clock=time.time, monotonic=time.monotonic):
        self.settings, self.session_id, self.created_at = settings, session_id, created_at
        self.clock, self.monotonic = clock, monotonic
        self.latest: HeartRateInput | None = None
        self.received_at: float | None = None
        self.received_monotonic: float | None = None

    def accept(self, value: HeartRateInput):
        now = self.clock()
        if value.session_id is not None and value.session_id != self.session_id:
            raise InputRejected("session_mismatch", 409)
        if value.timestamp < self.created_at:
            raise InputRejected("before_session_reset", 409)
        if value.timestamp > now + self.settings.future_tolerance_sec:
            raise InputRejected("timestamp_in_future")
        if now - value.timestamp > self.settings.ttl_sec:
            raise InputRejected("timestamp_expired")
        if self.latest is not None and value.timestamp <= self.latest.timestamp:
            raise InputRejected("timestamp_not_increasing", 409)
        self.latest = value.model_copy(deep=True)
        self.received_at, self.received_monotonic = now, self.monotonic()

    def status(self, now: float | None = None):
        now = self.clock() if now is None else now
        if self.latest is None:
            return {"fresh": False, "age_sec": None, "stale_reason": "external_missing",
                    "timestamp": None, "received_at": None, "heart_rate": None}
        age = max(0, now - self.latest.timestamp, self.monotonic() - self.received_monotonic)
        reason = None
        if now < self.received_at:
            reason = "server_clock_regressed"
        elif self.latest.timestamp > now:
            reason = "external_not_yet_current"
        elif age > self.settings.ttl_sec:
            reason = "external_expired"
        return {"fresh": reason is None, "age_sec": round(age, 3), "stale_reason": reason,
                "timestamp": self.latest.timestamp, "received_at": self.received_at,
                "heart_rate": self.latest.heart_rate, "source": self.latest.source,
                "signal_quality": self.latest.signal_quality, "duration_sec": self.latest.duration_sec}

    def read(self, second: int, timestamp: float, *, now: float | None = None) -> SensorReading:
        status = self.status(timestamp if now is None else now)
        reason = status["stale_reason"]
        if reason is None and (self.latest.timestamp > timestamp or self.received_at > timestamp):
            reason = "external_unavailable_at_tick"
        return SensorReading(timestamp=timestamp,
            heart_rate=self.latest.heart_rate if reason is None else None,
            field_sources=FieldSources(heart_rate=self.latest.source if reason is None else "unknown", resp_rate="unknown"),
            stale_reason=reason)
