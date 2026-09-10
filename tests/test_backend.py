import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.models import DemoRequest, Frame, Signals
from backend.session import Session
from backend.state.arousal import StateEngine


@pytest.mark.parametrize("report", ["mind_racing", "body_tense", "tired_but_awake", "already_sleepy"])
def test_complete_calming_session(report):
    session = Session(DemoRequest(scenario="calming", self_report=report))
    frames = [session.advance_to(t, 1000 + t) for t in range(201)]
    assert frames[-1].state.arousal < frames[0].state.arousal - 0.25
    stages = {f.ritual.stage for f in frames}
    assert {"assess", "settling", "fade_out", "end"} <= stages
    if report != "already_sleepy":
        assert "guided_breathing" in stages
    fade = [f.visual.intensity for f in frames if f.ritual.stage == "fade_out"]
    assert fade == sorted(fade, reverse=True)
    assert frames[-1].visual.model_dump() == {"intensity": 0, "noise": 0, "speed": 0}
    assert session.second == 180
    for frame in frames:
        Frame.model_validate(frame.model_dump())


def test_no_improvement_switches_then_times_out_without_claiming_success():
    session = Session(DemoRequest(scenario="not_responding", self_report="mind_racing"))
    frames = [session.advance_to(t, 1000 + t) for t in range(181)]
    assert frames[90].state.arousal >= frames[0].state.arousal
    assert frames[39].ritual.stage == "switch_method"
    assert all(f.ritual.stage != "settling" for f in frames)
    assert frames[170].ritual.stage == "fade_out"
    assert frames[180].ritual.stage == "end"


def test_baseline_frozen_and_initial_state_not_ready():
    engine = StateEngine("mind_racing")
    for _ in range(9):
        state = engine.update(Signals(heart_rate=86, resp_rate=16))
        assert not engine.ready and state.stability == 0
    engine.update(Signals(heart_rate=86, resp_rate=16))
    baseline = engine.baseline.model_copy()
    for _ in range(20):
        state = engine.update(Signals(heart_rate=70, resp_rate=10))
    assert engine.baseline == baseline
    assert len(engine.window) == 10
    assert state.arousal < 0.1 and state.stability == 1


def test_multiple_readers_do_not_advance_samples_and_large_gap_is_bounded():
    session = Session(DemoRequest(scenario="calming"))
    a = session.advance_to(10, 100)
    b = session.advance_to(10, 101)
    assert a.state == b.state and session.second == 10
    assert session.advance_to(100000, 100000).ritual.stage == "end"
    assert session.second == 180


def test_api_validation_reset_schema_and_active_socket():
    app = create_app()
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.post("/api/demo", json={"scenario": "bad"}).status_code == 422
        assert client.post("/api/demo", json={"scenario": "calming", "self_report": "bad"}).status_code == 422
        assert client.post("/api/demo", json={"scenario": "calming", "extra": 1}).status_code == 422
        saved = json.loads((Path(__file__).parents[1] / "docs/state.schema.json").read_text())
        assert client.get("/api/schema/state").json() == saved
        with client.websocket_connect("/ws/state") as ws:
            first = Frame.model_validate(ws.receive_json())
            assert first.ritual.stage == "assess"
            app.state.demo.session.advance_to(100, 1000)
            response = client.post("/api/demo", json={"scenario": "not_responding", "self_report": "already_sleepy"})
            assert response.status_code == 200 and response.json()["generation"] == 2
            next_frame = Frame.model_validate(ws.receive_json())
            assert next_frame.state.arousal == 0.38
            assert next_frame.ritual.stage == "assess"
            assert not app.state.demo.session.engine.ready
        with client.websocket_connect("/ws/state") as ws:
            assert Frame.model_validate(ws.receive_json()).state.arousal == 0.38


def test_cors_for_frontend():
    with TestClient(create_app()) as client:
        response = client.options("/api/demo", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
