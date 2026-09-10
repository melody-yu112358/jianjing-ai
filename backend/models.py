"""Version 1.1 wire contract: additive nested fields, unchanged top-level shape."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Scenario = Literal["calming", "not_responding", "already_sleepy"]
SelfReport = Literal["mind_racing", "body_tense", "tired_but_awake", "already_sleepy"]
Stage = Literal["assess", "guided_breathing", "settling", "switch_method", "fade_out", "end"]
Unit = Annotated[float, Field(ge=0, le=1)]
StateClass = Literal["activated", "settling", "stable", "not_responding", "discomfort", "ready_to_disengage"]
Action = Literal["continue_breathing", "slow_down", "reduce_stimulation",
                 "switch_to_natural_breathing", "switch_to_grounding", "fade_out", "end"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Signals(Model):
    heart_rate: float = Field(gt=0)
    resp_rate: float = Field(gt=0)


class State(Model):
    arousal: Unit
    stability: Unit
    trend: Literal["up", "down", "flat"]
    state_class: StateClass
    confidence: Unit
    reason_codes: list[str]


class Ritual(Model):
    stage: Stage
    inhale_sec: float = Field(ge=0)
    exhale_sec: float = Field(ge=0)
    action: Action
    audio_intensity: Unit
    reason: str


class RitualDecision(Model):
    """Identical validated result for every controller implementation."""
    stage: Stage
    action: Action
    inhale_sec: float = Field(ge=0)
    exhale_sec: float = Field(ge=0)
    visual_intensity: Unit
    audio_intensity: Unit
    message: str
    reason: str

    def as_ritual(self) -> Ritual:
        return Ritual(**self.model_dump(exclude={"visual_intensity", "message"}))


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
    data_source: Literal["simulated", "mixed", "sensor", "unknown"] = "simulated"
    schema_version: Literal["1.1"] = "1.1"
    scope: Literal["shared_process"] = "shared_process"


class FeedbackRequest(Model):
    event: Literal["discomfort"]
