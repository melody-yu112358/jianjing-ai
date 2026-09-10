"""Pure controller interface: identical (state, context) gives identical decisions."""
from abc import ABC, abstractmethod
from dataclasses import dataclass

from backend.config import CONTROLLER_CONFIG, ControllerConfig
from backend.models import RitualDecision, SelfReport, Stage, State
from backend.state.arousal import clamp


@dataclass(frozen=True)
class ControllerContext:
    second: int
    self_report: SelfReport
    baseline_ready: bool = False
    stage: Stage = "assess"
    stage_started: int = 0
    last_decision: int = 0
    fade_start_intensity: float = 0
    previous_visual_intensity: float = 0
    intervention_started: int | None = None


class RitualController(ABC):
    def __init__(self, config: ControllerConfig = CONTROLLER_CONFIG):
        self.config = config
        self.MAX_SECONDS = config.max_seconds

    @abstractmethod
    def decide(self, state: State, context: ControllerContext) -> RitualDecision:
        """Return a validated finite action; no network or mutable session state here."""


class RuleBasedController(RitualController):
    def decide(self, state: State, context: ControllerContext) -> RitualDecision:
        cfg, ctx = self.config, context
        stage = ctx.stage
        reason = "hold_current_stage"
        if state.state_class == "discomfort":
            stage, reason = "end", "user_reported_discomfort"
        elif stage == "end":
            reason = "session_ended"
        elif stage == "fade_out":
            if ctx.second - ctx.stage_started >= cfg.fade_seconds:
                stage, reason = "end", "fade_completed"
            else:
                reason = "fade_in_progress"
        elif ctx.second >= cfg.max_seconds - cfg.fade_seconds:
            stage, reason = "fade_out", "session_time_limit"
        elif not ctx.baseline_ready:
            stage, reason = "assess", "baseline_pending"
        elif stage == "assess":
            stage = "settling" if ctx.self_report == "already_sleepy" else "guided_breathing"
            reason = "sleepy_short_path" if stage == "settling" else "baseline_ready"
        elif state.state_class == "ready_to_disengage":
            stage, reason = "fade_out", "disengagement_criteria_met"
        elif ctx.second - ctx.last_decision >= cfg.decision_seconds:
            if state.state_class == "not_responding":
                stage, reason = "switch_method", "no_improvement_after_intervention"
            elif state.state_class in ("settling", "stable"):
                stage, reason = "settling", "reduce_interaction_after_improvement"
            elif stage == "guided_breathing":
                stage, reason = "switch_method", "response_not_clear"
            elif stage == "settling" and (state.trend == "up" or state.stability < cfg.worsening_stability):
                stage, reason = "switch_method", "state_became_less_stable"

        if stage == "end":
            intensity = 0.0
        elif stage == "fade_out":
            start = ctx.fade_start_intensity if ctx.stage == "fade_out" else ctx.previous_visual_intensity
            elapsed = ctx.second - ctx.stage_started if ctx.stage == "fade_out" else 0
            intensity = clamp(start * (1 - elapsed / cfg.fade_seconds))
        else:
            factor = cfg.reduced_factor if stage in ("settling", "switch_method") else 1
            intensity = clamp((0.2 + state.arousal * 0.65) * factor)

        action = {"assess": "switch_to_natural_breathing", "guided_breathing": "continue_breathing",
                  "settling": "reduce_stimulation", "switch_method": "switch_to_grounding",
                  "fade_out": "fade_out", "end": "end"}[stage]
        if stage == "switch_method" and ctx.self_report == "body_tense":
            action = "switch_to_natural_breathing"
        if stage == "guided_breathing" and state.trend == "down" and state.arousal < cfg.slow_down_arousal:
            action = "slow_down"
        inhale = cfg.inhale_seconds if stage == "guided_breathing" else 0
        exhale = (cfg.tense_exhale_seconds if ctx.self_report == "body_tense"
                  else cfg.exhale_seconds) if inhale else 0
        # Slowing here means reducing stimulus intensity, not forcing deeper breathing.
        if action == "slow_down":
            intensity = clamp(intensity * cfg.reduced_factor)
            reason = "lower_stimulus_while_settling"
        messages = {
            "assess": "先照平常的方式呼吸，我们正在建立本次参考。",
            "guided_breathing": "先不用努力睡着，只把呼气稍微拉长一点。",
            "settling": "按舒服的节奏就好，可以不再跟着提示呼吸。",
            "switch_method": "暂时没有明显变化，不必控制呼吸，把注意力轻轻放在周围的声音上。",
            "fade_out": "到这里就好，让提示慢慢安静下来。",
            "end": "本次仪式已结束，今晚不用再看我了。",
        }
        message = messages[stage]
        if stage == "switch_method" and action == "switch_to_natural_breathing":
            message = "不必继续跟随节奏，恢复舒服的自然呼吸。"
        if state.state_class == "discomfort":
            message = "已停止引导，请恢复自然呼吸，不必继续本次体验。"
        return RitualDecision(stage=stage, action=action, inhale_sec=inhale, exhale_sec=exhale,
                              visual_intensity=intensity, audio_intensity=intensity,
                              message=message, reason=reason)


class LLMController(RitualController):
    """Reserved extension point; deliberately unavailable, with no SDK/API calls."""
    def decide(self, state: State, context: ControllerContext) -> RitualDecision:
        raise NotImplementedError("LLMController is reserved; use RuleBasedController in this phase")
