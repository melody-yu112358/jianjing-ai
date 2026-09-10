import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from backend.llm.provider import LLMSettings
from backend.main import create_app
from backend.models import DemoRequest, Frame
from backend.sensors.adapters import SimulatorAdapter
from backend.sensors.base import FieldSources, SensorReading, SignalFrame
from backend.sensors.external import ExternalHeartRateAdapter, HeartRateInput, InputRejected, SensorSettings
from backend.sensors.simulator import Simulator
from backend.session import DemoRuntime, Session


class Clock:
    def __init__(self):
        self.wall, self.mono = 1000.0, 100.0

    def time(self):
        return self.wall

    def monotonic(self):
        return self.mono

    def advance(self, seconds):
        self.wall += seconds
        self.mono += seconds


def runtime(mode="mixed", ttl=5):
    clock = Clock()
    value = DemoRuntime(LLMSettings(), SensorSettings(mode=mode, ttl_sec=ttl),
                        clock=clock.time, monotonic=clock.monotonic)
    return value, clock


def post_value(runtime, clock, heart_rate=100):
    runtime.session.external_hr.accept(HeartRateInput(timestamp=clock.wall, heart_rate=heart_rate))


@pytest.mark.parametrize("scenario", ["calming", "not_responding", "already_sleepy"])
def test_simulator_adapter_and_full_default_trajectory_unchanged(scenario):
    sim = Simulator(scenario)
    adapter = SimulatorAdapter(sim)
    plain = Session(DemoRequest(scenario=scenario))
    wrapped = Session(DemoRequest(scenario=scenario), sensor_settings=SensorSettings(mode="simulated"))
    frames = []
    for t in range(181):
        reading = adapter.read(t, 1000 + t)
        assert reading.signals() == sim.sample(t)
        assert reading.field_sources.model_dump() == {"heart_rate": "simulated", "resp_rate": "simulated"}
        actual = wrapped.advance_to(t, 1000 + t)
        assert plain.advance_to(t, 1000 + t) == actual
        frames.append(actual.model_dump())
    # Recorded independently from main f6c8ae1 before Phase 4A (181 complete v1 frames).
    expected = {
        "calming": "d7d7be5d3b8c0784648f112a4ed182551fc0e517f46f05618bbcb9080100bdd7",
        "not_responding": "07a413ea432658b3471228a2d0705d90fe25cc3e002c6b46faabd547f599a083",
        "already_sleepy": "063f9ea9c3888add9f3ad658279818b6bdb89fe9d10311da9846fb39db093a7b",
    }
    assert hashlib.sha256(json.dumps(frames, sort_keys=True).encode()).hexdigest() == expected[scenario]


def test_partial_reading_cannot_be_sent_to_state_engine_as_complete_signal():
    partial = SensorReading(timestamp=1000, heart_rate=90,
                            field_sources=FieldSources(heart_rate="external", resp_rate="unknown"))
    with pytest.raises(ValidationError):
        SignalFrame.model_validate(partial.model_dump())


@pytest.mark.parametrize("hr_source,resp_source,expected", [
    ("simulated", "simulated", "simulated"), ("external", "simulated", "mixed"),
    ("simulated", "external", "mixed"), ("external", "external", "sensor"),
    ("unknown", "simulated", "unknown"), ("external", "unknown", "unknown"),
])
def test_source_aggregation(hr_source, resp_source, expected):
    assert SignalFrame(timestamp=1000, heart_rate=90, resp_rate=12,
        field_sources=FieldSources(heart_rate=hr_source, resp_rate=resp_source)).data_source == expected


def test_mixed_post_consumed_on_tick_and_same_tick_does_not_duplicate_samples():
    r, clock = runtime()
    first = r.current_frame()
    assert first.signals.heart_rate == r.session.simulator.sample(0).heart_rate
    post_value(r, clock)
    packet = r.current_control_frame()
    assert packet.data_source == "mixed" and packet.payload.signals.heart_rate == 100
    assert packet.payload.signals.resp_rate == r.session.simulator.sample(0).resp_rate
    assert len(r.session.engine.window) == 1
    clock.advance(1)
    r.current_frame()
    assert r.session.engine.window[-1].heart_rate == 100
    assert r.sensor_status()["last_consumed"]["field_sources"]["heart_rate"] == "external"


def test_ttl_fallback_source_and_recovery():
    r, clock = runtime(ttl=2)
    post_value(r, clock, 110)
    assert r.current_control_frame().data_source == "mixed"
    clock.advance(2)
    assert r.current_control_frame().data_source == "mixed"
    clock.advance(0.01)
    fallback = r.current_control_frame()
    assert fallback.data_source == "simulated"
    assert fallback.payload.signals.heart_rate == r.session.simulator.sample(2).heart_rate
    status = r.sensor_status()
    assert status["stale_reason"] == "external_expired" and status["sensor_status"] == "fallback"
    assert status["external_heart_rate"]["fresh"] is False
    assert status["heart_rate"]["source"] == "simulated"
    post_value(r, clock, 95)
    assert r.current_control_frame().payload.signals.heart_rate == 95
    assert r.sensor_status()["effective_data_source"] == "mixed"


def test_missing_and_simulated_mode_ignore_external_input():
    r, clock = runtime()
    assert r.sensor_status()["stale_reason"] == "external_missing"
    r, clock = runtime("simulated")
    post_value(r, clock, 120)
    assert r.current_control_frame().data_source == "simulated"
    assert r.current_frame().signals.heart_rate == r.session.simulator.sample(0).heart_rate
    assert r.sensor_status()["external_heart_rate"]["fresh"]
    assert r.sensor_status()["heart_rate"]["source"] == "simulated"


@pytest.mark.parametrize("delta,reason", [(3, "timestamp_in_future"), (-6, "timestamp_expired")])
def test_invalid_time_never_replaces_valid_buffer(delta, reason):
    r, clock = runtime()
    clock.advance(10)
    post_value(r, clock)
    with pytest.raises(InputRejected, match=reason):
        r.session.external_hr.accept(HeartRateInput(timestamp=clock.wall + delta, heart_rate=115))
    assert r.current_frame().signals.heart_rate == 100


def test_small_future_value_is_held_until_current():
    r, clock = runtime()
    r.session.external_hr.accept(HeartRateInput(timestamp=clock.wall + 1, heart_rate=105))
    assert r.current_control_frame().data_source == "simulated"
    assert r.sensor_status()["stale_reason"] == "external_not_yet_current"
    clock.advance(1)
    assert r.current_control_frame().data_source == "mixed"


def test_reset_clears_cache_and_rejects_old_session_timestamp_and_id():
    r, clock = runtime()
    post_value(r, clock)
    old_id = r.current_control_frame().session_id
    old_timestamp = clock.wall
    clock.advance(0.1)
    r.reset(DemoRequest(scenario="already_sleepy"))
    fresh = r.current_control_frame()
    assert fresh.data_source == "simulated" and fresh.seq == 0 and fresh.session_id != old_id
    assert r.sensor_status()["stale_reason"] == "external_missing"
    with pytest.raises(InputRejected, match="before_session_reset"):
        r.session.external_hr.accept(HeartRateInput(timestamp=old_timestamp, heart_rate=99))
    with pytest.raises(InputRejected, match="session_mismatch"):
        r.session.external_hr.accept(HeartRateInput(timestamp=clock.wall, heart_rate=99, session_id=old_id))
    assert r.sensor_status()["external_heart_rate"]["heart_rate"] is None


def test_duplicate_and_out_of_order_values_rejected():
    r, clock = runtime()
    clock.advance(1)
    post_value(r, clock)
    for t in (clock.wall, clock.wall - 0.5):
        with pytest.raises(InputRejected, match="timestamp_not_increasing"):
            r.session.external_hr.accept(HeartRateInput(timestamp=t, heart_rate=90))


def test_no_retroactive_external_backfill_on_reconnect():
    r, clock = runtime()
    r.current_frame()
    clock.advance(20)
    post_value(r, clock, 130)
    r.current_frame()
    assert r.session.engine.baseline.heart_rate < 90
    samples = list(r.session.engine.window)
    assert all(s.heart_rate < 90 for s in samples[:-1])
    assert samples[-1].heart_rate == 130


def test_monotonic_expiry_and_wall_clock_regression():
    r, clock = runtime(ttl=2)
    post_value(r, clock)
    clock.mono += 3  # wall time frozen
    assert r.sensor_status()["effective_data_source"] == "simulated"
    assert r.sensor_status()["stale_reason"] == "external_expired"
    clock.wall -= 1
    assert r.sensor_status()["stale_reason"] == "server_clock_regressed"


def test_expiry_after_end_keeps_labels_honest_without_engine_updates():
    r, clock = runtime()
    r.current_frame()
    clock.advance(180)
    post_value(r, clock, 100)
    packet = r.current_control_frame()
    assert packet.payload.guidance.stage == "end" and packet.data_source == "mixed"
    baseline = r.session.engine.baseline.model_copy()
    clock.advance(6)
    packet = r.current_control_frame()
    assert packet.data_source == "simulated" and packet.payload.signals.heart_rate != 100
    assert r.session.second == 180 and r.session.engine.baseline == baseline
    assert packet.payload.visual.intensity == 0


def test_status_reads_do_not_start_or_advance_session():
    r, clock = runtime()
    for _ in range(3):
        r.sensor_status()
    assert r.started_at is None and r.session.second == -1
    assert r.sensor_status()["last_consumed"] is None


@pytest.mark.parametrize("body", [
    {"timestamp": 1000, "heart_rate": 29}, {"timestamp": 1000, "heart_rate": 221},
    {"timestamp": 1000, "heart_rate": "82"}, {"timestamp": 1000, "heart_rate": True},
    {"timestamp": "1000", "heart_rate": 82}, {"timestamp": -1, "heart_rate": 82},
    {"timestamp": 1000}, {"timestamp": 1000, "heart_rate": 82, "device_id": "extra"},
])
def test_rest_invalid_input(body):
    app = create_app(LLMSettings(), SensorSettings())
    app.state.demo, _ = runtime()
    with TestClient(app) as client:
        assert client.post("/api/sensor/heart-rate", json=body).status_code == 422
        assert client.get("/api/sensor/status").json()["external_heart_rate"]["heart_rate"] is None


def test_rest_post_status_and_both_wire_schemas():
    r, clock = runtime()
    app = create_app(LLMSettings(), SensorSettings())
    app.state.demo = r
    root = Path(__file__).parents[1]
    validators = {route: Draft202012Validator(json.loads((root / path).read_text())) for route, path in (
        ("/ws/state", "docs/state.schema.json"), ("/ws/control", "docs/agent-control-v2.schema.json"))}
    with TestClient(app) as client:
        response = client.post("/api/sensor/heart-rate", json={"timestamp": clock.wall, "heart_rate": 105})
        assert response.status_code == 200 and response.json()["accepted"]
        assert client.get("/api/sensor/status").json()["effective_data_source"] == "mixed"
        assert client.get("/api/demo").json()["data_source"] == "mixed"
        assert client.get("/health").json()["data_source"] == "mixed"
        for route in validators:
            with client.websocket_connect(route) as ws:
                raw = ws.receive_json()
                validators[route].validate(raw)
                values = raw["payload"] if route == "/ws/control" else raw
                assert values["signals"]["heart_rate"] == 105
                if route == "/ws/control":
                    assert raw["data_source"] == "mixed"
                else:
                    Frame.model_validate(raw)
        assert client.post("/api/sensor/heart-rate", json={"timestamp": clock.wall, "heart_rate": 90}).status_code == 409


def test_sensor_settings_environment_and_no_sensor_only(monkeypatch):
    monkeypatch.delenv("SENSOR_MODE", raising=False)
    monkeypatch.delenv("EXTERNAL_HR_TTL_SEC", raising=False)
    assert SensorSettings.from_env() == SensorSettings()
    monkeypatch.setenv("SENSOR_MODE", "mixed")
    monkeypatch.setenv("EXTERNAL_HR_TTL_SEC", "2")
    assert SensorSettings.from_env() == SensorSettings("mixed", 2)
    monkeypatch.setenv("SENSOR_MODE", "sensor")
    with pytest.raises(ValueError):
        SensorSettings.from_env()


@pytest.mark.parametrize("value", [float("nan"), float("inf"), 0, 61])
def test_invalid_ttl(value):
    with pytest.raises(ValueError):
        SensorSettings(ttl_sec=value)


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("field", ["timestamp", "heart_rate"])
def test_nonfinite_http_input_returns_422_not_500(number, field):
    app = create_app(LLMSettings(), SensorSettings())
    with TestClient(app, raise_server_exceptions=False) as client:
        body = '{"timestamp":1000,"heart_rate":82}'
        body = body.replace('1000' if field == "timestamp" else '82', number)
        response = client.post("/api/sensor/heart-rate", content=body, headers={"Content-Type": "application/json"})
        assert response.status_code == 422
        assert client.get("/api/sensor/status").json()["external_heart_rate"]["heart_rate"] is None
