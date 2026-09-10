"""Version 1 wire contract. No extra fields or non-finite numbers."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Scenario = Literal["calming", "not_responding"]
SelfReport = Literal["mind_racing", "body_tense", "tired_but_awake", "already_sleepy"]
Stage = Literal["assess", "guided_breathing", "settling", "switch_method", "fade_out", "end"]
Unit = Annotated[float, Field(ge=0, le=1)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Signals(Model):
    heart_rate: float = Field(gt=0)
    resp_rate: float = Field(gt=0)


class State(Model):
    arousal: Unit
    stability: Unit
    trend: Literal["up", "down", "flat"]


class Ritual(Model):
    stage: Stage
    inhale_sec: float = Field(ge=0)
    exhale_sec: float = Field(ge=0)


class Visual(Model):
    intensity: Unit
    noise: Unit
    speed: Unit


class Frame(Model):
    timestamp: float = Field(ge=0, description="Unix UTC seconds, not milliseconds")
    signals: Signals
    state: State
    ritual: Ritual
    visual: Visual
    message: str


class DemoRequest(Model):
    scenario: Scenario
    self_report: SelfReport | None = None


class DemoStatus(Model):
    scenario: Scenario
    self_report: SelfReport
    generation: int
    data_source: Literal["simulated"] = "simulated"
    schema_version: Literal["1.0"] = "1.0"
    scope: Literal["shared_process"] = "shared_process"
