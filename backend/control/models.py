"""v2.0 contract based on the frontend AGENT_INTERFACE.md."""
from typing import Literal

from pydantic import Field, model_validator

from backend.models import Model, Signals, Stage, Unit

DataSource = Literal["simulated", "sensor", "mixed", "unknown"]
VisualMode = Literal["serenity", "ripple", "fold", "storm", "pulse"]
MAX_SAFE_INTEGER = 2**53 - 1


class VisualControl(Model):
    # The backend sends all optional artistic controls on every snapshot.
    mode: VisualMode
    intensity: Unit
    noise: Unit
    speed: Unit
    deformation: Unit
    frequency: Unit
    turbulence: Unit
    particle_density: Unit
    particle_spread: Unit
    line_density: Unit
    line_activity: Unit
    glow: Unit
    pulse: Unit = Field(description="Amplitude, not frequency; guidance supplies breathing timing")
    hue: float = Field(ge=0, le=360)
    transition_sec: float = Field(ge=0.1, le=15)


class Guidance(Model):
    text: str = Field(max_length=4000)
    stage: Stage
    inhale_sec: float = Field(ge=0, le=60)
    exhale_sec: float = Field(ge=0, le=60)

    @model_validator(mode="after")
    def timing(self):
        if (self.inhale_sec > 0) != (self.exhale_sec > 0):
            raise ValueError("Both breathing timings must be positive or both zero")
        if self.stage != "guided_breathing" and (self.inhale_sec or self.exhale_sec):
            raise ValueError("Only guided_breathing permits nonzero timings")
        return self


class DebugState(Model):
    arousal: Unit
    stability: Unit
    trend: Literal["up", "down", "flat"]


class ControlPayload(Model):
    visual: VisualControl
    guidance: Guidance
    signals: Signals | None = None
    state: DebugState | None = None

    @model_validator(mode="after")
    def ending(self):
        if self.guidance.stage == "end" and any((self.visual.intensity, self.visual.noise, self.visual.speed)):
            raise ValueError("End must stop and hide visuals")
        return self


class ControlFrame(Model):
    type: Literal["agent.control"] = "agent.control"
    version: Literal["2.0"] = "2.0"
    session_id: str = Field(min_length=1, max_length=128)
    seq: int = Field(ge=0, le=MAX_SAFE_INTEGER, strict=True)
    timestamp: float = Field(ge=0, description="Current Unix UTC seconds")
    data_source: DataSource = "simulated"
    payload: ControlPayload


def control_schema():
    """Include cross-field wire constraints not emitted by Pydantic validators."""
    schema = ControlFrame.model_json_schema()
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["required"] = list(schema["properties"])
    guidance = schema["$defs"]["Guidance"]
    guidance["allOf"] = [
        {"oneOf": [
            {"properties": {"inhale_sec": {"const": 0}, "exhale_sec": {"const": 0}}},
            {"properties": {"stage": {"const": "guided_breathing"},
                            "inhale_sec": {"exclusiveMinimum": 0}, "exhale_sec": {"exclusiveMinimum": 0}}},
        ]}
    ]
    schema["$defs"]["ControlPayload"]["allOf"] = [{
        "if": {"properties": {"guidance": {"properties": {"stage": {"const": "end"}}}}},
        "then": {"properties": {"visual": {"properties": {
            key: {"const": 0} for key in ("intensity", "noise", "speed")}}}},
    }]
    # Optional wire telemetry is omitted, never sent as null.
    for field, model in (("signals", "Signals"), ("state", "DebugState")):
        schema["$defs"]["ControlPayload"]["properties"][field] = {"$ref": f"#/$defs/{model}"}
    return schema
