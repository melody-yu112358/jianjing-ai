"""Read-only projections of adopted decisions; no sampling or controller calls."""
from statistics import mean
from typing import Literal

from pydantic import Field

from backend.models import Model, Unit, State, Signals, RitualDecision, SelfReport

DecisionSource = Literal["rule", "mock_llm", "llm"]


class HistoryPoint(Model):
    session: int
    arousal: Unit
    stability: Unit


class Baseline(Model):
    source: Literal["simulated_demo_history"] = "simulated_demo_history"
    history: list[HistoryPoint]
    arousal: Unit
    stability: Unit


def demo_baseline() -> Baseline:
    rows = [HistoryPoint(session=i + 1, arousal=a, stability=s) for i, (a, s) in enumerate(
        [(0.49, 0.63), (0.43, 0.71), (0.48, 0.65), (0.45, 0.68),
         (0.47, 0.66), (0.44, 0.70), (0.46, 0.66)])]
    return Baseline(history=rows, arousal=round(mean(r.arousal for r in rows), 3),
                    stability=round(mean(r.stability for r in rows), 3))


class Provenance(Model):
    data_source: Literal["simulated", "mixed", "sensor", "unknown"]
    baseline_source: Literal["simulated_demo_history"] = "simulated_demo_history"
    decision_source: DecisionSource | None
    explanation_source: Literal["backend", "demo_fixture"] = "backend"


class Trace(Model):
    at: int = Field(ge=0)
    observation: Signals
    state: State
    decision: RitualDecision
    decision_source: DecisionSource | None
    next_reassessment_sec: int | None


class TonightPlan(Model):
    source: Literal["controller_projection", "demo_fixture"] = "controller_projection"
    initial_decision: RitualDecision | None
    reassessment_interval_sec: int
    # These explain supported controller behavior, not an extra decision policy.
    conditional_note: str = "后续按状态重新判断：未趋稳时可换方式，趋稳后可减少刺激，满足退出条件后淡出。"


class Response(Model):
    arousal_delta: float
    stability_delta: float
    reference: Literal["session_initial_state"] = "session_initial_state"
    observation_only: Literal[True] = True


class ExplainabilitySnapshot(Model):
    version: Literal["1.0"] = "1.0"
    session_id: str
    timestamp: float | None
    session_second: int | None
    scope: Literal["shared_process", "local_replay"] = "shared_process"
    self_report: SelfReport
    provenance: Provenance
    baseline: Baseline
    session_signal_baseline: Signals | None
    current_state: State | None
    initial_state: State | None
    tonight_plan: TonightPlan
    decision_trace: Trace | None
    decision_history: list[Trace]
    response: Response | None


def snapshot(session) -> ExplainabilitySnapshot:
    frame, trace = session.frame, session.explanation_trace
    initial = session.explanation_initial
    reading = session.last_consumed_reading
    return ExplainabilitySnapshot(
        session_id=session.control.session_id,
        timestamp=frame.timestamp if frame else None,
        session_second=session.second if frame else None,
        self_report=session.simulator.self_report,
        provenance=Provenance(data_source=reading.data_source if reading else "unknown",
                              decision_source=trace.decision_source if trace else None),
        baseline=demo_baseline(), session_signal_baseline=session.engine.baseline,
        current_state=frame.state if frame else None, initial_state=initial,
        tonight_plan=TonightPlan(initial_decision=session.explanation_plan,
                                 reassessment_interval_sec=session.controller.config.decision_seconds),
        decision_trace=trace, decision_history=session.explanation_history,
        response=Response(arousal_delta=round(frame.state.arousal-initial.arousal, 3),
                          stability_delta=round(frame.state.stability-initial.stability, 3))
        if frame and initial and session.engine.ready else None,
    )


def record(session, state, decision, observed, *, significant: bool):
    """Called in the tick that adopts RitualDecision, before any further sensor read."""
    source = getattr(session.controller, "executed_source", "rule")
    if session.explanation_initial is None or (session.engine.ready and "baseline_pending" in session.explanation_initial.reason_codes):
        session.explanation_initial = state.model_copy(deep=True)
    if session.explanation_plan is None and decision.stage != "assess":
        session.explanation_plan = decision.model_copy(deep=True)
    next_at = None
    if decision.stage not in ("fade_out", "end"):
        next_at = (session.second + 1 if not session.engine.ready else
                   session.context.last_decision + session.controller.config.decision_seconds)
    trace = Trace(at=session.second, observation=observed, state=state,
                  decision=decision, decision_source=source, next_reassessment_sec=next_at)
    previous = session.explanation_trace
    session.explanation_trace = trace.model_copy(deep=True)
    if significant or previous is None or previous.decision_source != source:
        session.explanation_history = [*session.explanation_history[-31:], trace.model_copy(deep=True)]
