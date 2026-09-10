import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.config import StateConfig
from backend.main import create_app
from backend.models import DemoRequest, Frame, RitualDecision, Signals
from backend.ritual.controller import ControllerContext, LLMController, RuleBasedController
from backend.session import Session
from backend.state.arousal import StateEngine
from backend.state.classification import StateClassifier


def trajectory(scenario):
    session = Session(DemoRequest(scenario=scenario))
    return [session.advance_to(t, 1000 + t) for t in range(181)]


def test_calming_explains_disengagement_and_no_response_explains_switch():
    calming = trajectory("calming")
    ready = next(f for f in calming if f.state.state_class == "ready_to_disengage")
    assert ready.ritual.stage == "fade_out"
    assert {"heart_rate_decreasing", "resp_rate_decreasing", "stable_for_two_windows",
            "disengagement_criteria_met"} <= set(ready.state.reason_codes)
    assert 0 < ready.state.confidence <= 0.95
    unchanged = trajectory("not_responding")
    assert unchanged[39].state.state_class == "not_responding"
    assert unchanged[39].ritual.stage == "switch_method"
    assert "no_improvement_after_intervention" in unchanged[39].state.reason_codes
    assert not any(f.state.state_class == "ready_to_disengage" for f in unchanged)


def test_sleepy_path_is_shorter_and_never_guided():
    sleepy, calming = trajectory("already_sleepy"), trajectory("calming")
    assert all(f.ritual.stage != "guided_breathing" for f in sleepy)
    assert sleepy[9].state.state_class == "settling"
    assert "low_arousal_sleepy_start" in sleepy[9].state.reason_codes
    assert all(f.ritual.inhale_sec == f.ritual.exhale_sec == 0 for f in sleepy)
    sleepy_end = next(i for i, f in enumerate(sleepy) if f.ritual.stage == "end")
    calming_end = next(i for i, f in enumerate(calming) if f.ritual.stage == "end")
    assert sleepy_end <= 60 and sleepy_end < calming_end
    assert any(f.state.state_class == "stable" for f in sleepy)
    assert any(f.state.state_class == "ready_to_disengage" for f in sleepy)


@pytest.mark.parametrize("second", [0, 9, 39, 70, 180, 10000])
def test_discomfort_immediate_latched_even_at_same_tick_and_after_end(second):
    session = Session(DemoRequest(scenario="calming"))
    session.advance_to(second, 1000)
    sample_count = session.second
    stopped = session.stop_for_discomfort(1000.1)
    assert session.second == sample_count
    for frame in [stopped, session.advance_to(second + 1, 1001)]:
        assert frame.state.state_class == "discomfort"
        assert frame.state.reason_codes == ["user_reported_discomfort"]
        assert frame.ritual.stage == frame.ritual.action == "end"
        assert frame.ritual.inhale_sec == frame.ritual.exhale_sec == 0
        assert frame.ritual.audio_intensity == frame.visual.intensity == frame.visual.speed == 0


def test_discomfort_rest_push_and_reset():
    with TestClient(create_app()) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()
            assert client.post("/api/feedback", json={"event": "unknown"}).status_code == 422
            response = client.post("/api/feedback", json={"event": "discomfort"})
            assert response.status_code == 200
            assert response.json()["ritual"]["stage"] == "end"
            stopped = Frame.model_validate(ws.receive_json())
            assert stopped.state.state_class == "discomfort"
            assert client.post("/api/demo", json={"scenario": "already_sleepy"}).status_code == 200
            fresh = Frame.model_validate(ws.receive_json())
            assert fresh.ritual.stage == "assess" and fresh.state.state_class != "discomfort"


def test_stability_requires_duration_and_break_resets_counter():
    classifier = StateClassifier(StateConfig())
    kwargs = dict(arousal=0.3, stability=0.9, trend="flat", hr_delta=-2,
                  resp_delta=-1, resp_std=0.1, ready=True, trend_ready=True,
                  self_report="mind_racing", initial_arousal=0.78,
                  intervention_seconds=30, discomfort=False)
    first = classifier.classify(**kwargs)
    assert first.state_class != "stable" and "stable_for_two_windows" not in first.reason_codes
    for _ in range(9):
        stable = classifier.classify(**kwargs)
    assert stable.state_class == "stable"
    broken = classifier.classify(**{**kwargs, "resp_std": 0.9})
    assert broken.state_class != "stable" and classifier.stable_samples == 0
    for _ in range(19):
        waiting = classifier.classify(**kwargs)
    assert waiting.state_class != "ready_to_disengage"
    assert classifier.classify(**kwargs).state_class == "ready_to_disengage"


def test_flat_signal_without_intervention_is_not_nonresponse_and_config_applies():
    engine = StateEngine("mind_racing", StateConfig(baseline_samples=5, rolling_samples=5))
    for _ in range(50):
        state = engine.update(Signals(heart_rate=86, resp_rate=16))
    assert engine.ready and len(engine.window) == 5 and len(engine.baseline_samples) == 5
    assert state.state_class == "activated"
    assert "no_improvement_after_intervention" not in state.reason_codes


@pytest.mark.parametrize("scenario", ["calming", "not_responding", "already_sleepy"])
def test_controller_is_pure_reproducible_and_contract_is_shared(scenario):
    state = trajectory(scenario)[40].state
    context = ControllerContext(second=40, self_report="mind_racing", baseline_ready=True,
                                stage="guided_breathing", stage_started=9, last_decision=9)
    controller = RuleBasedController()
    first = controller.decide(state, context)
    for _ in range(3):
        assert controller.decide(state, context) == first
        assert RuleBasedController().decide(state, context) == first
    assert RitualDecision.model_validate_json(first.model_dump_json()) == first
    with pytest.raises(ValidationError):
        RitualDecision.model_validate({**first.model_dump(), "action": "medical_advice"})
    with pytest.raises(NotImplementedError):
        LLMController().decide(state, context)
    saved = json.loads((Path(__file__).parents[1] / "docs/ritual-decision.schema.json").read_text())
    assert RitualDecision.model_json_schema() == saved


def test_wire_shape_preserves_original_field_paths():
    frame = trajectory("calming")[40].model_dump()
    assert set(frame) == {"timestamp", "signals", "state", "ritual", "visual", "message"}
    assert {"arousal", "stability", "trend"} <= set(frame["state"])
    assert {"stage", "inhale_sec", "exhale_sec"} <= set(frame["ritual"])
    assert set(frame["visual"]) == {"intensity", "noise", "speed"}
