"""Explainable classification independent of controller implementation/scenario."""
from backend.config import StateConfig
from backend.models import SelfReport, State


class StateClassifier:
    def __init__(self, config: StateConfig):
        self.config = config
        self.stable_samples = 0

    def classify(self, *, arousal: float, stability: float, trend: str,
                 hr_delta: float, resp_delta: float, resp_std: float,
                 ready: bool, trend_ready: bool, self_report: SelfReport,
                 initial_arousal: float, intervention_seconds: int,
                 discomfort: bool) -> State:
        cfg = self.config
        reasons = [f"self_report_{self_report}"]
        if discomfort:
            self.stable_samples = 0
            return State(arousal=arousal, stability=stability, trend=trend,
                         state_class="discomfort", confidence=1,
                         reason_codes=["user_reported_discomfort"])
        if not ready:
            self.stable_samples = 0
            return State(arousal=arousal, stability=stability, trend=trend,
                         state_class="activated", confidence=0,
                         reason_codes=reasons + ["baseline_pending"])
        reasons.append("baseline_ready")
        hr_down = hr_delta <= -cfg.hr_decrease
        resp_down = resp_delta <= -cfg.resp_decrease
        if hr_down:
            reasons.append("heart_rate_decreasing")
        if resp_down:
            reasons.append("resp_rate_decreasing")
        if trend_ready:
            reasons.append(f"rolling_trend_{trend}")
        else:
            reasons.append("trend_window_pending")
        resp_stable = resp_std <= cfg.stable_resp_std
        if resp_stable:
            reasons.append("respiration_stable")
        sustained = (trend_ready and resp_stable and stability >= cfg.stable_stability
                     and arousal <= cfg.stable_arousal and trend != "up")
        self.stable_samples = self.stable_samples + 1 if sustained else 0
        stable = self.stable_samples >= cfg.rolling_samples * cfg.stable_windows
        held = self.stable_samples >= cfg.rolling_samples * cfg.ready_windows
        if stable:
            reasons.append("stable_duration_met")
        if self.stable_samples >= 2 * cfg.rolling_samples:
            reasons.append("stable_for_two_windows")
        ready_to_leave = held and (arousal <= cfg.ready_arousal or self_report == "already_sleepy")
        no_response = (intervention_seconds >= cfg.no_response_seconds
                       and initial_arousal - arousal < cfg.minimum_improvement)
        improving = (trend == "down" and stability >= cfg.settling_stability
                     and (hr_down or resp_down))
        sleepy_start = (self_report == "already_sleepy" and arousal <= cfg.stable_arousal
                        and resp_stable and stability >= cfg.stable_stability and trend != "up")
        if sleepy_start:
            reasons.append("low_arousal_sleepy_start")
        predicates = {"ready_to_disengage": ready_to_leave, "stable": stable,
                      "not_responding": no_response, "settling": improving or sleepy_start, "activated": True}
        state_class = next(name for name in cfg.classification_priority if predicates[name])
        if state_class == "ready_to_disengage":
            reasons.append("disengagement_criteria_met")
        elif state_class == "not_responding":
            reasons.append("no_improvement_after_intervention")
        elif state_class == "activated":
            reasons.append("settling_criteria_not_met")
        # Evidence availability and consistency, NOT calibrated clinical probability.
        coverage = 1.0 if trend_ready else 0.5
        confidence = round(min(0.95, coverage * (0.5 + 0.5 * stability)), 3)
        return State(arousal=arousal, stability=stability, trend=trend,
                     state_class=state_class, confidence=confidence, reason_codes=reasons)
