"""Shared, lazily advanced session; subscribers never add extra sensor samples."""
import time
from dataclasses import replace

from backend.models import DemoRequest, DemoStatus, Frame, Visual
from backend.ritual.controller import ControllerContext, DecisionRecord, RitualController, RuleBasedController
from backend.llm.provider import LLMSettings
from backend.control.adapter import ControlAdapter
from backend.sensors.simulator import Simulator
from backend.sensors.adapters import SimulatorAdapter, MixedAdapter
from backend.sensors.external import ExternalHeartRateAdapter, SensorSettings, InputRejected
from backend.state.arousal import StateEngine, clamp


class Session:
    def __init__(self, config: DemoRequest, controller: RitualController | None = None,
                 sensor_settings: SensorSettings | None = None, *, clock=None, monotonic=None):
        self.simulator = Simulator(config.scenario, config.self_report)
        self.engine = StateEngine(self.simulator.self_report)
        self.controller = controller or RuleBasedController()
        self.context = ControllerContext(second=0, self_report=self.simulator.self_report)
        self.discomfort = False
        self.second = -1
        self.frame: Frame | None = None
        self.control = ControlAdapter()
        self.sensor_settings = sensor_settings or SensorSettings()
        self.clock = clock or time.time
        self.external_hr = ExternalHeartRateAdapter(self.sensor_settings, self.control.session_id,
            created_at=self.clock(), clock=self.clock, monotonic=monotonic or time.monotonic)
        self.sensor_adapter = SimulatorAdapter(self.simulator)
        if self.sensor_settings.mode == "mixed":
            self.sensor_adapter = MixedAdapter(self.sensor_adapter, self.external_hr)
        self.last_reading = None
        self.last_consumed_reading = None
        self.measurements = {"pre": None, "post": None}
        self.last_ppg_result = None
        self.explanation_trace = None
        self.explanation_initial = None
        self.explanation_plan = None
        self.explanation_history = []

    def advance_to(self, second: int, timestamp: float) -> Frame:
        if second < 0:
            raise ValueError("second must be nonnegative")
        # At most 181 updates per session, even after a long period without clients.
        target = min(second, self.controller.MAX_SECONDS)
        while self.second < target:
            self.second += 1
            # Do not backfill a newly received external value into historical ticks.
            sample_time = max(0, timestamp - (second - self.second))
            reading = self.sensor_adapter.read(self.second, sample_time, now=timestamp)
            signal = reading.signals()
            self.last_consumed_reading = reading
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
            self.control.observe(self.frame, self.second, self.controller.config.fade_seconds)
        # Refresh live provenance even at the same tick or after the state is frozen.
        # This does not add another sample to the engine's 1 Hz window.
        self.last_reading = self.sensor_adapter.read(self.second, timestamp, now=timestamp)
        self.frame = self.frame.model_copy(update={"signals": self.last_reading.signals()})
        return self.frame.model_copy(update={"timestamp": timestamp})

    def _decide(self, state):
        ctx = replace(self.context, second=self.second, baseline_ready=self.engine.ready)
        decision = self.controller.decide(state, ctx)
        changed = decision.stage != ctx.stage
        due = self.engine.ready and (ctx.stage == "assess" or self.second - ctx.last_decision >= self.controller.config.decision_seconds)
        started = ctx.intervention_started
        if started is None and decision.stage in ("guided_breathing", "settling", "switch_method"):
            started = self.second
        history = ctx.recent_decisions
        if due or changed or decision.action != ctx.previous_action:
            history = (*history, DecisionRecord(decision.action, state.state_class))[-3:]
        self.context = replace(ctx, stage=decision.stage,
            stage_started=self.second if changed else ctx.stage_started,
            last_decision=self.second if due else ctx.last_decision,
            fade_start_intensity=ctx.previous_visual_intensity if changed and decision.stage == "fade_out" else ctx.fade_start_intensity,
            previous_visual_intensity=decision.visual_intensity, intervention_started=started,
            previous_action=decision.action, recent_decisions=history)
        from backend.explainability import record
        observed = self.last_consumed_reading.signals() if self.last_consumed_reading else self.frame.signals
        record(self, state, decision, observed,
               significant=due or changed or decision.action != ctx.previous_action)
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
        self.last_reading = self.sensor_adapter.read(self.second, timestamp, now=timestamp)
        self.frame = self.frame.model_copy(update={"signals": self.last_reading.signals()})
        self.control.observe(self.frame, self.second, self.controller.config.fade_seconds)
        return self.frame


class DemoRuntime:
    def __init__(self, settings: LLMSettings | None = None, sensor_settings: SensorSettings | None = None,
                 *, clock=None, monotonic=None):
        self.settings = settings or LLMSettings.from_env()
        self.sensor_settings = sensor_settings or SensorSettings.from_env()
        self.clock, self.monotonic = clock or time.time, monotonic or time.monotonic
        self.generation = 0
        self.reset(DemoRequest(scenario="calming"))

    def reset(self, config: DemoRequest) -> DemoStatus:
        if hasattr(self, "session"):
            self.cancel_pending()
        controller = RuleBasedController()
        if self.settings.mode != "rule":
            from backend.llm.controller import LLMController
            from backend.llm.mock import MockLLMProvider
            controller = LLMController(settings=self.settings,
                provider=MockLLMProvider() if self.settings.mode == "mock_llm" else None)
        self.session = Session(config, controller, self.sensor_settings, clock=self.clock, monotonic=self.monotonic)
        self.started_at: float | None = None
        self.generation += 1
        return self.status()

    def status(self) -> DemoStatus:
        sim = self.session.simulator
        return DemoStatus(scenario=sim.scenario, self_report=sim.self_report, generation=self.generation,
                          data_source=self.sensor_status()["effective_data_source"])

    def current_frame(self) -> Frame:
        now = self.monotonic()
        if self.started_at is None:
            self.started_at = now
        return self.session.advance_to(int(now - self.started_at), self.clock())

    def report_discomfort(self) -> Frame:
        return self.session.stop_for_discomfort(self.clock())

    def current_control_frame(self, *, include_debug: bool = True):
        frame = self.current_frame()
        return self.session.control.snapshot(frame, include_debug=include_debug,
                                             data_source=self.session.last_reading.data_source)

    def sensor_status(self):
        session, now = self.session, self.clock()
        reading = session.sensor_adapter.read(max(0, session.second), now, now=now)
        external = session.external_hr.status(now)
        source = reading.field_sources.heart_rate
        return {"mode": self.sensor_settings.mode, "session_id": session.control.session_id, "server_timestamp": now,
            "effective_data_source": reading.data_source,
            "sensor_status": "fallback" if reading.stale_reason else "active",
            "stale_reason": reading.stale_reason, "ttl_sec": self.sensor_settings.ttl_sec,
            "heart_rate": {"source": source, "fresh": True,
                           "age_sec": external["age_sec"] if source in ("external", "phone_ppg", "apple_watch") else 0,
                           "value": reading.heart_rate},
            "resp_rate": {"source": "simulated", "fresh": True, "age_sec": 0, "value": reading.resp_rate},
            "external_heart_rate": external,
            "last_consumed": session.last_consumed_reading.model_dump() if session.last_consumed_reading else None}

    def accept_heart_rate(self, value):
        phase, records = value.measurement_phase, self.session.measurements
        if phase == "post" and records["pre"] is None:
            raise InputRejected("pre_measurement_required", 409)
        if phase == "pre" and records["post"] is not None:
            raise InputRejected("reset_before_new_pre_measurement", 409)
        if phase == "post" and value.timestamp <= records["pre"]["timestamp"]:
            raise InputRejected("post_must_follow_pre", 409)
        self.session.external_hr.accept(value)
        if phase:
            records[phase] = value.model_dump()

    def session_summary(self):
        status = self.sensor_status()
        pre, post = self.session.measurements["pre"], self.session.measurements["post"]
        delta = None if pre is None or post is None else round(post["heart_rate"]-pre["heart_rate"], 1)
        return {"session_id": self.session.control.session_id,
            "pre_ritual_hr": pre["heart_rate"] if pre else None, "post_ritual_hr": post["heart_rate"] if post else None,
            "pre_measurement": pre, "post_measurement": post, "delta_bpm": delta,
            "heart_rate_source": status["heart_rate"]["source"], "resp_rate_source": "simulated",
            "controller_mode": self.settings.mode, "data_source": status["effective_data_source"],
            "last_ppg_result": self.session.last_ppg_result,
            "message": ("等待完成前测和后测。" if delta is None else
                        "本次体验前后测得的心率相同。" if delta == 0 else "本次体验前后测得的心率发生变化。")}

    def cancel_pending(self):
        if hasattr(self.session.controller, "cancel"):
            self.session.controller.cancel()

    def controller_status(self):
        controller = self.session.controller
        return {"mode": self.settings.mode, "source": getattr(controller, "last_source", "rule"),
                "calls": getattr(controller, "calls", 0), "successes": getattr(controller, "successes", 0),
                "failures": getattr(controller, "failures", 0), "last_error": getattr(controller, "last_error", None)}
