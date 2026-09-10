"""Prototype interaction indices only. Thresholds are not medical cutoffs."""
from collections import deque
from statistics import mean, pstdev

from backend.models import SelfReport, Signals, State

INITIAL = {"mind_racing": 0.78, "body_tense": 0.74,
           "tired_but_awake": 0.62, "already_sleepy": 0.38}


def clamp(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)


class StateEngine:
    BASELINE_SIZE = 10
    WINDOW_SIZE = 10

    def __init__(self, self_report: SelfReport):
        self.initial = INITIAL[self_report]
        self.baseline_samples: list[Signals] = []
        self.baseline: Signals | None = None
        self.window: deque[Signals] = deque(maxlen=self.WINDOW_SIZE)
        self.history: deque[float] = deque(maxlen=11)

    @property
    def ready(self) -> bool:
        return self.baseline is not None

    def update(self, signal: Signals) -> State:
        self.window.append(signal)
        if not self.ready:
            self.baseline_samples.append(signal)
            if len(self.baseline_samples) == self.BASELINE_SIZE:
                self.baseline = Signals(
                    heart_rate=mean(s.heart_rate for s in self.baseline_samples),
                    resp_rate=mean(s.resp_rate for s in self.baseline_samples),
                )
        if not self.ready:
            return State(arousal=self.initial, stability=0, trend="flat")
        hr = [s.heart_rate for s in self.window]
        resp = [s.resp_rate for s in self.window]
        # Relative to this session, anchored to a subjective demo prior.
        arousal = clamp(self.initial + 0.35 * (mean(hr) - self.baseline.heart_rate) / 15
                        + 0.35 * (mean(resp) - self.baseline.resp_rate) / 6)
        stability = clamp(1 - 0.5 * pstdev(hr) / 2 - 0.5 * pstdev(resp) / 0.8)
        self.history.append(arousal)
        delta = arousal - self.history[0]
        trend = "flat"
        if len(self.history) == 11:
            trend = "down" if delta < -0.015 else "up" if delta > 0.015 else "flat"
        return State(arousal=arousal, stability=stability, trend=trend)
