"""Finite-state rule controller. It never reads the scenario name."""
from dataclasses import dataclass

from backend.models import Ritual, SelfReport, Stage, State
from backend.state.arousal import clamp


@dataclass(frozen=True)
class Decision:
    ritual: Ritual
    visual_intensity: float
    message: str


class RitualController:
    DECISION_INTERVAL = 30
    MAX_SECONDS = 180
    FADE_SECONDS = 10

    def __init__(self, self_report: SelfReport):
        self.self_report = self_report
        self.stage: Stage = "assess"
        self.entered_at = 0
        self.last_decision = 0
        self.fade_start_intensity = 0.0

    def update(self, second: int, state: State, ready: bool) -> Decision:
        next_stage = self.stage
        if self.stage == "end":
            pass
        elif self.stage == "fade_out":
            if second - self.entered_at >= self.FADE_SECONDS:
                next_stage = "end"
        elif second >= self.MAX_SECONDS - self.FADE_SECONDS:
            next_stage = "fade_out"
        elif self.stage == "assess" and ready:
            next_stage = "settling" if self.self_report == "already_sleepy" else "guided_breathing"
            self.last_decision = second
        elif ready and second - self.last_decision >= self.DECISION_INTERVAL:
            self.last_decision = second
            improving = state.trend == "down" and state.stability >= 0.5
            if self.stage == "guided_breathing":
                next_stage = "settling" if improving else "switch_method"
            elif self.stage == "switch_method":
                if improving:
                    next_stage = "settling"
            elif self.stage == "settling":
                if state.arousal <= 0.35 and state.stability >= 0.65 and state.trend != "up":
                    next_stage = "fade_out"
                elif state.trend == "up" or state.stability < 0.4:
                    next_stage = "switch_method"
        if next_stage != self.stage:
            if next_stage == "fade_out":
                self.fade_start_intensity = self._intensity(second, state)
            self.stage, self.entered_at = next_stage, second

        messages = {
            "assess": "先照平常的方式呼吸，我们正在建立本次参考。",
            "guided_breathing": "先不用努力睡着，只把呼气稍微拉长一点。",
            "settling": "按舒服的节奏就好，可以不再跟着提示呼吸。",
            "switch_method": "暂时没有明显变化，不必控制呼吸，把注意力轻轻放在周围的声音上。",
            "fade_out": "到这里就好，让提示慢慢安静下来。",
            "end": "本次仪式已结束，今晚不用再看我了。",
        }
        inhale = 4.0 if self.stage == "guided_breathing" else 0.0
        exhale = (5.0 if self.self_report == "body_tense" else 6.0) if inhale else 0.0
        return Decision(Ritual(stage=self.stage, inhale_sec=inhale, exhale_sec=exhale),
                        self._intensity(second, state), messages[self.stage])

    def _intensity(self, second: int, state: State) -> float:
        if self.stage == "end":
            return 0.0
        if self.stage == "fade_out":
            return clamp(self.fade_start_intensity * (1 - (second - self.entered_at) / self.FADE_SECONDS))
        factor = 0.65 if self.stage in ("settling", "switch_method") else 1.0
        return clamp((0.2 + state.arousal * 0.65) * factor)
