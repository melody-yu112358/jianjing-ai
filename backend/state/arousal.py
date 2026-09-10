"""Prototype interaction indices only. Thresholds are not medical cutoffs."""
from collections import deque
from statistics import mean, pstdev

from backend.models import SelfReport, Signals, State
from backend.config import STATE_CONFIG, StateConfig
from backend.state.classification import StateClassifier

INITIAL = STATE_CONFIG.priors


def clamp(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)


class StateEngine:
    BASELINE_SIZE = 10
    WINDOW_SIZE = 10

    def __init__(self, self_report: SelfReport, config: StateConfig = STATE_CONFIG):
        self.config = config
        self.self_report = self_report
        self.initial = config.priors[self_report]
        self.classifier = StateClassifier(config)
        self.baseline_samples: list[Signals] = []
        self.baseline: Signals | None = None
        self.window: deque[Signals] = deque(maxlen=config.rolling_samples)
        self.history: deque[float] = deque(maxlen=config.trend_seconds + 1)

    @property
    def ready(self) -> bool:
        return self.baseline is not None

    def update(self, signal: Signals, *, intervention_seconds: int = 0,
               discomfort: bool = False) -> State:
        cfg = self.config
        self.window.append(signal)
        if not self.ready:
            self.baseline_samples.append(signal)
            if len(self.baseline_samples) == cfg.baseline_samples:
                self.baseline = Signals(
                    heart_rate=mean(s.heart_rate for s in self.baseline_samples),
                    resp_rate=mean(s.resp_rate for s in self.baseline_samples),
                )
        if not self.ready:
            return self.classifier.classify(arousal=self.initial, stability=0, trend="flat",
                hr_delta=0, resp_delta=0, resp_std=0, ready=False, trend_ready=False,
                self_report=self.self_report, initial_arousal=self.initial,
                intervention_seconds=intervention_seconds, discomfort=discomfort)
        hr = [s.heart_rate for s in self.window]
        resp = [s.resp_rate for s in self.window]
        # Relative to this session, anchored to a subjective demo prior.
        hr_delta = mean(hr) - self.baseline.heart_rate
        resp_delta = mean(resp) - self.baseline.resp_rate
        arousal = clamp(self.initial + cfg.hr_weight * hr_delta / cfg.hr_delta_scale
                        + cfg.resp_weight * resp_delta / cfg.resp_delta_scale)
        stability = clamp(1 - 0.5 * pstdev(hr) / cfg.hr_std_scale - 0.5 * pstdev(resp) / cfg.resp_std_scale)
        self.history.append(arousal)
        delta = arousal - self.history[0]
        trend = "flat"
        trend_ready = len(self.history) == cfg.trend_seconds + 1
        if trend_ready:
            trend = "down" if delta < -cfg.trend_delta else "up" if delta > cfg.trend_delta else "flat"
        return self.classifier.classify(arousal=arousal, stability=stability, trend=trend,
            hr_delta=hr_delta, resp_delta=resp_delta, resp_std=pstdev(resp),
            ready=len(self.window) == cfg.rolling_samples, trend_ready=trend_ready,
            self_report=self.self_report, initial_arousal=self.initial,
            intervention_seconds=intervention_seconds, discomfort=discomfort)
