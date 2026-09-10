"""Shared, lazily advanced session; subscribers never add extra sensor samples."""
import time
from dataclasses import replace

from backend.models import DemoRequest, DemoStatus, Frame, Visual
from backend.ritual.controller import ControllerContext, RitualController, RuleBasedController
from backend.sensors.simulator import Simulator
from backend.state.arousal import StateEngine, clamp


class Session:
    def __init__(self, config: DemoRequest, controller: RitualController | None = None):
        self.simulator = Simulator(config.scenario, config.self_report)
        self.engine = StateEngine(self.simulator.self_report)
        self.controller = controller or RuleBasedController()
        self.context = ControllerContext(second=0, self_report=self.simulator.self_report)
        self.discomfort = False
        self.second = -1
        self.frame: Frame | None = None

    def advance_to(self, second: int, timestamp: float) -> Frame:
        if second < 0:
            raise ValueError("second must be nonnegative")
        # At most 181 updates per session, even after a long period without clients.
        target = min(second, self.controller.MAX_SECONDS)
        while self.second < target:
            self.second += 1
            signal = self.simulator.sample(self.second)
            started = self.context.intervention_started
            state = self.engine.update(signal, intervention_seconds=0 if started is None else self.second - started,
                                       discomfort=self.discomfort)
            decision = self._decide(state)
            intensity = decision.visual_intensity
            self.frame = Frame(
                timestamp=timestamp, signals=signal, state=state, ritual=decision.as_ritual(),
                visual=Visual(intensity=intensity,
                              noise=clamp((1 - state.stability) * intensity),
                              speed=clamp((0.2 + 0.8 * state.arousal) * intensity)),
                message=decision.message,
            )
        return self.frame.model_copy(update={"timestamp": timestamp})

    def _decide(self, state):
        ctx = replace(self.context, second=self.second, baseline_ready=self.engine.ready)
        decision = self.controller.decide(state, ctx)
        changed = decision.stage != ctx.stage
        due = self.engine.ready and (ctx.stage == "assess" or self.second - ctx.last_decision >= self.controller.config.decision_seconds)
        started = ctx.intervention_started
        if started is None and decision.stage in ("guided_breathing", "settling", "switch_method"):
            started = self.second
        self.context = replace(ctx, stage=decision.stage,
            stage_started=self.second if changed else ctx.stage_started,
            last_decision=self.second if due else ctx.last_decision,
            fade_start_intensity=ctx.previous_visual_intensity if changed and decision.stage == "fade_out" else ctx.fade_start_intensity,
            previous_visual_intensity=decision.visual_intensity, intervention_started=started)
        return decision

    def stop_for_discomfort(self, timestamp: float) -> Frame:
        """Latch a user stop immediately; do not invent an extra sensor sample."""
        self.discomfort = True
        if self.frame is None:
            return self.advance_to(0, timestamp)
        state = self.frame.state.model_copy(update={"state_class": "discomfort", "confidence": 1.0,
                                                   "reason_codes": ["user_reported_discomfort"]})
        decision = self._decide(state)
        self.frame = Frame(timestamp=timestamp, signals=self.frame.signals, state=state,
                           ritual=decision.as_ritual(), visual=Visual(intensity=0, noise=0, speed=0),
                           message=decision.message)
        return self.frame


class DemoRuntime:
    def __init__(self):
        self.generation = 0
        self.reset(DemoRequest(scenario="calming"))

    def reset(self, config: DemoRequest) -> DemoStatus:
        self.session = Session(config)
        self.started_at: float | None = None
        self.generation += 1
        return self.status()

    def status(self) -> DemoStatus:
        sim = self.session.simulator
        return DemoStatus(scenario=sim.scenario, self_report=sim.self_report, generation=self.generation)

    def current_frame(self) -> Frame:
        now = time.monotonic()
        if self.started_at is None:
            self.started_at = now
        return self.session.advance_to(int(now - self.started_at), time.time())

    def report_discomfort(self) -> Frame:
        return self.session.stop_for_discomfort(time.time())
