"""Deterministic 1 Hz signal fixtures with linear interpolation and bounded jitter."""
import json
import math
from pathlib import Path

from backend.models import Scenario, SelfReport, Signals

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


class Simulator:
    def __init__(self, scenario: Scenario, self_report: SelfReport | None = None):
        if scenario not in ("calming", "not_responding", "already_sleepy"):
            raise ValueError("Unknown scenario")
        data = json.loads((DATA_DIR / f"demo_{scenario}.json").read_text(encoding="utf-8"))
        self.scenario = scenario
        self.self_report = self_report or data["self_report"]
        self.keyframes = data["keyframes"]

    def sample(self, second: int) -> Signals:
        if second < 0:
            raise ValueError("second must be nonnegative")
        second = min(second, self.keyframes[-1]["second"])
        left, right = self.keyframes[-2:]
        for a, b in zip(self.keyframes, self.keyframes[1:]):
            if second <= b["second"]:
                left, right = a, b
                break
        ratio = (second - left["second"]) / (right["second"] - left["second"])
        values = {key: left[key] + ratio * (right[key] - left[key])
                  for key in ("heart_rate", "resp_rate", "jitter")}
        return Signals(
            heart_rate=round(values["heart_rate"] + values["jitter"] * math.sin(second * 1.7), 2),
            resp_rate=round(values["resp_rate"] + values["jitter"] * 0.35 * math.sin(second * 1.3), 2),
        )
