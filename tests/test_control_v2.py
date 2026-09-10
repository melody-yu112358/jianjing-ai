import asyncio
import json
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, ValidationError as SchemaError
from pydantic import ValidationError

from backend.control.models import ControlFrame, Guidance, VisualControl, control_schema
from backend.llm.provider import LLMSettings
from backend.main import create_app
from backend.models import DemoRequest, Frame
from backend.session import DemoRuntime, Session
from backend.visual.mapper import ENERGY_FIELDS, map_visual

SCHEMA = json.loads((Path(__file__).parents[1] / "docs/agent-control-v2.schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA)


def validate(raw):
    VALIDATOR.validate(raw)
    return ControlFrame.model_validate(raw)


def trajectory(scenario):
    session = Session(DemoRequest(scenario=scenario))
    frames = []
    for second in range(181):
        frame = session.advance_to(second, 1000 + second)
        frames.append(session.control.snapshot(frame))
    return session, frames


def test_saved_schema_and_endpoint_match():
    Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA == control_schema()
    with TestClient(create_app(LLMSettings())) as client:
        assert client.get("/api/schema/control").json() == SCHEMA


@pytest.mark.parametrize("scenario", ["calming", "not_responding", "already_sleepy"])
def test_full_trajectories_ranges_fade_and_end(scenario):
    session, frames = trajectory(scenario)
    assert [f.seq for f in frames] == list(range(181))
    assert len({f.session_id for f in frames}) == 1
    UUID(frames[0].session_id.removeprefix("session-"))
    for frame in frames:
        validate(frame.model_dump(exclude_none=True))
        assert frame.data_source == "simulated"
    fade = [f.payload.visual for f in frames if f.payload.guidance.stage == "fade_out"]
    assert len(fade) >= 2 and fade[0].intensity > fade[-1].intensity > 0
    for key in ENERGY_FIELDS:
        values = [getattr(v, key) for v in fade]
        assert values == sorted(values, reverse=True)
    first_fade = next(i for i, f in enumerate(frames) if f.payload.guidance.stage == "fade_out")
    assert fade[0].intensity == frames[first_fade - 1].payload.visual.intensity
    assert frames[-1].payload.guidance.stage == "end"
    assert all(getattr(frames[-1].payload.visual, key) == 0 for key in ENERGY_FIELDS)
    if scenario == "calming":
        assert frames[60].payload.visual.intensity < frames[10].payload.visual.intensity
    elif scenario == "already_sleepy":
        assert all(f.payload.guidance.stage != "guided_breathing" for f in frames)
        assert frames[9].payload.visual.intensity < 0.25
        assert frames[48].payload.guidance.stage == "end"
    else:
        assert frames[39].payload.guidance.stage == "switch_method"
        assert frames[39].payload.visual.mode != frames[10].payload.visual.mode
        assert frames[39].payload.guidance.text != frames[10].payload.guidance.text


def test_mapper_pure_and_does_not_read_llm_intensity_or_message():
    session = Session(DemoRequest(scenario="calming"))
    frame = session.advance_to(10, 1000)
    first = map_visual(frame.state, frame.ritual)
    for _ in range(4):
        assert map_visual(frame.state, frame.ritual) == first
    alternate = frame.model_copy(update={"message": "different", "visual": frame.visual.model_copy(update={"intensity": 1})})
    assert map_visual(alternate.state, alternate.ritual) == first
    alternate_state = frame.state.model_copy(update={"state_class": "stable"})
    assert map_visual(alternate_state, frame.ritual) == first
    assert first.pulse > 0  # amplitude; timing remains in guidance


def test_observer_independent_of_v2_reader_count_and_skipped_ticks():
    first, second = (Session(DemoRequest(scenario="calming")) for _ in range(2))
    for t in range(78):
        f = first.advance_to(t, t)
        for _ in range(3):
            first.control.snapshot(f)
    f2 = second.advance_to(77, 77)
    assert first.control.visual == second.control.visual
    assert first.second == second.second == 77
    assert second.control.snapshot(f2).seq == 0


def test_two_protocols_sequences_reset_reconnect_and_debug_omission():
    app = create_app(LLMSettings())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as old, client.websocket_connect("/ws/control") as control:
            legacy = Frame.model_validate(old.receive_json())
            first = validate(control.receive_json())
            assert first.seq == 0 and first.payload.signals == legacy.signals
            assert first.payload.guidance.text == legacy.message
            second = validate(control.receive_json())
            assert second.seq > first.seq and second.session_id == first.session_id
            assert second.timestamp > first.timestamp
            with client.websocket_connect("/ws/control?debug=false") as extra:
                raw = extra.receive_json()
                assert "signals" not in raw["payload"] and "state" not in raw["payload"]
                third = validate(raw)
                assert third.session_id == first.session_id and third.seq > second.seq
            response = client.post("/api/demo", json={"scenario": "already_sleepy"})
            assert response.status_code == 200
            # Buffered old-session frames may arrive before the new snapshot.
            for _ in range(4):
                reset = validate(control.receive_json())
                if reset.session_id != first.session_id:
                    break
            assert reset.session_id != first.session_id and reset.seq == 0
            assert reset.data_source == "simulated"
            # v1 still emits v1; it never reserves a v2 sequence.
            assert set(old.receive_json()) == set(legacy.model_dump())
        with client.websocket_connect("/ws/control") as reconnected:
            resumed = validate(reconnected.receive_json())
            assert resumed.session_id == reset.session_id and resumed.seq > reset.seq


@pytest.mark.parametrize("second", [0, 10, 75, 180])
def test_discomfort_immediately_clears_v2_even_same_tick(second):
    session = Session(DemoRequest(scenario="calming"))
    session.advance_to(second, 1000)
    stopped = session.stop_for_discomfort(1000.1)
    packet = session.control.snapshot(stopped)
    assert packet.payload.guidance.stage == "end"
    assert packet.payload.visual.intensity == packet.payload.visual.noise == packet.payload.visual.speed == 0
    validate(packet.model_dump(exclude_none=True))


@pytest.mark.parametrize("changes", [
    {"inhale_sec": 4, "exhale_sec": 0}, {"inhale_sec": 61, "exhale_sec": 6},
    {"stage": "settling", "inhale_sec": 4, "exhale_sec": 6}, {"text": "x" * 4001},
])
def test_guidance_invalid_in_model_and_schema(changes):
    _, frames = trajectory("calming")
    raw = frames[10].model_dump(exclude_none=True)
    raw["payload"]["guidance"].update(changes)
    with pytest.raises(ValidationError):
        Guidance.model_validate(raw["payload"]["guidance"])
    with pytest.raises(SchemaError):
        VALIDATOR.validate(raw)


@pytest.mark.parametrize("field,value", [("intensity", 1.01), ("noise", -0.1), ("hue", 361),
    ("transition_sec", 0), ("transition_sec", 16), ("mode", "anxiety"), ("pulse", float("inf"))])
def test_visual_invalid_ranges(field, value):
    _, frames = trajectory("calming")
    raw = frames[10].model_dump(exclude_none=True)
    raw["payload"]["visual"][field] = value
    with pytest.raises(ValidationError):
        VisualControl.model_validate(raw["payload"]["visual"])
    with pytest.raises(SchemaError):
        VALIDATOR.validate(raw)


def test_wire_end_constraint_and_optional_telemetry():
    _, frames = trajectory("calming")
    raw = frames[-1].model_dump(exclude_none=True)
    raw["payload"]["visual"]["speed"] = 0.01
    with pytest.raises(ValidationError):
        ControlFrame.model_validate(raw)
    with pytest.raises(SchemaError):
        VALIDATOR.validate(raw)
    raw["payload"]["visual"]["speed"] = 0
    del raw["payload"]["signals"]
    del raw["payload"]["state"]
    validate(raw)


@pytest.mark.parametrize("seq", [-1, 2**53, 0.5, True])
def test_invalid_sequence(seq):
    _, frames = trajectory("calming")
    raw = frames[0].model_dump(exclude_none=True)
    raw["seq"] = seq
    with pytest.raises(ValidationError):
        ControlFrame.model_validate(raw)
    with pytest.raises(SchemaError):
        VALIDATOR.validate(raw)


@pytest.mark.parametrize("a,stability,trend,mode", [
    (1, 0, "up", "storm"), (0.8, 0.5, "up", "fold"),
    (0, 1, "flat", "serenity"), (0.6, 0.5, "down", "ripple"),
])
def test_mapper_boundary_inputs_and_artistic_modes(a, stability, trend, mode):
    frame = Session(DemoRequest(scenario="calming")).advance_to(0, 1000)
    state = frame.state.model_copy(update={"arousal": a, "stability": stability, "trend": trend})
    visual = map_visual(state, frame.ritual)
    assert visual.mode == mode
    assert all(0 <= getattr(visual, key) <= 1 for key in ENERGY_FIELDS)


@pytest.mark.parametrize("mode", ["mock_llm", "llm"])
def test_v2_with_mock_and_unconfigured_llm_fallback(mode):
    async def run():
        runtime = DemoRuntime(LLMSettings(mode=mode))
        runtime.reset(DemoRequest(scenario="not_responding"))
        for second in range(45):
            frame = runtime.session.advance_to(second, 1000 + second)
            validate(runtime.session.control.snapshot(frame).model_dump(exclude_none=True))
            if runtime.session.controller.task:
                await runtime.session.controller.task
        status = runtime.controller_status()
        assert status["successes" if mode == "mock_llm" else "failures"] >= 2
        assert frame.ritual.stage == "switch_method"
        runtime.cancel_pending()
    asyncio.run(run())
