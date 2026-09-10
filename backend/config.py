"""Tunable prototype rules, not clinical thresholds. All windows assume 1 Hz."""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class StateConfig:
    baseline_samples: int = 10
    rolling_samples: int = 10
    trend_seconds: int = 10
    trend_delta: float = 0.015
    hr_weight: float = 0.35
    resp_weight: float = 0.35
    hr_delta_scale: float = 15
    resp_delta_scale: float = 6
    hr_std_scale: float = 2
    resp_std_scale: float = 0.8
    hr_decrease: float = 1
    resp_decrease: float = 0.5
    stable_resp_std: float = 0.35
    settling_stability: float = 0.5
    stable_stability: float = 0.65
    stable_arousal: float = 0.4
    ready_arousal: float = 0.35
    stable_windows: int = 1
    ready_windows: int = 2
    no_response_seconds: int = 30
    minimum_improvement: float = 0.05
    # First matching rule wins, after the unconditional discomfort/baseline guards.
    classification_priority: tuple[str, ...] = (
        "ready_to_disengage", "stable", "not_responding", "settling", "activated"
    )
    priors: dict[str, float] = field(default_factory=lambda: {
        "mind_racing": 0.78, "body_tense": 0.74,
        "tired_but_awake": 0.62, "already_sleepy": 0.38,
    })

    def __post_init__(self):
        if min(self.baseline_samples, self.rolling_samples, self.trend_seconds,
               self.stable_windows, self.ready_windows) < 1:
            raise ValueError("Window lengths must be positive")
        if self.ready_windows < self.stable_windows:
            raise ValueError("Ready duration must not be shorter than stable duration")
        if min(self.hr_delta_scale, self.resp_delta_scale, self.hr_std_scale, self.resp_std_scale) <= 0:
            raise ValueError("Normalization scales must be positive")


@dataclass(frozen=True)
class ControllerConfig:
    decision_seconds: int = 30
    max_seconds: int = 180
    fade_seconds: int = 10
    inhale_seconds: float = 4
    exhale_seconds: float = 6
    tense_exhale_seconds: float = 5
    reduced_factor: float = 0.65
    slow_down_arousal: float = 0.6
    worsening_stability: float = 0.4


STATE_CONFIG = StateConfig()
CONTROLLER_CONFIG = ControllerConfig()
