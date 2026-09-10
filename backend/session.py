"""Shared, lazily advanced session; subscribers never add extra sensor samples."""
import time

from backend.models import DemoRequest, DemoStatus, Frame, Visual
from backend.ritual.controller import RitualController
from backend.sensors.simulator import Simulator
from backend.state.arousal import StateEngine, clamp


class Session:
    def __init__(self, config: DemoRequest):
        self.simulator = Simulator(config.scenario, config.self_report)
        self.engine = StateEngine(self.simulator.self_report)
        self.controller = RitualController(self.simulator.self_report)
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
            state = self.engine.update(signal)
            decision = self.controller.update(self.second, state, self.engine.ready)
            intensity = decision.visual_intensity
            self.frame = Frame(
                timestamp=timestamp, signals=signal, state=state, ritual=decision.ritual,
                visual=Visual(intensity=intensity,
                              noise=clamp((1 - state.stability) * intensity),
                              speed=clamp((0.2 + 0.8 * state.arousal) * intensity)),
                message=decision.message,
            )
        return self.frame.model_copy(update={"timestamp": timestamp})


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
