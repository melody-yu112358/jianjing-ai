import asyncio
import math
import random

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api import ppg as endpoint
from backend.control.models import ControlFrame
from backend.llm.provider import LLMSettings
from backend.main import create_app
from backend.models import DemoRequest
from backend.sensors.apple_watch import AppleWatchHeartRateAdapter
from backend.sensors.external import HeartRateInput, InputRejected, SensorSettings
from backend.sensors.ppg import RGBSample, estimate_ppg
from test_sensors import runtime


def waveform(bpm=72, duration=25, fps=30, noise=0, drift=0):
    rng = random.Random(12)
    return [RGBSample(t=i/fps, r=180+2*math.sin(2*math.pi*bpm/60*i/fps)+rng.uniform(-noise,noise)+drift*i/fps,
                      g=70, b=50) for i in range(round(duration*fps)+1)]


@pytest.mark.parametrize("bpm", [45, 60, 72, 90, 120, 150, 180])
def test_known_ppg_bpm(bpm):
    result = estimate_ppg(waveform(bpm), torch_enabled=True)
    assert result.valid and abs(result.heart_rate-bpm) <= 1.3
    assert 0.65 <= result.signal_quality <= 1 and result.failure_reason is None


@pytest.mark.parametrize("fps", [20, 25, 30])
def test_detrend_resampling_and_moderate_noise(fps):
    result = estimate_ppg(waveform(90, fps=fps, noise=0.25, drift=0.2), torch_enabled=True)
    assert result.valid and abs(result.heart_rate-90) < 2


@pytest.mark.parametrize("case", ["flat", "noise", "gap", "motion", "dark", "clipped", "uncovered", "short", "slow", "duplicate", "fast_bpm", "slow_bpm", "changing"])
def test_unreliable_waveforms_rejected(case):
    samples = waveform()
    rng = random.Random(123)
    if case == "flat": samples = [s.model_copy(update={"r": 180}) for s in samples]
    if case == "noise": samples = [s.model_copy(update={"r": 180+rng.uniform(-5,5)}) for s in samples]
    if case == "gap": samples = [s for s in samples if not 10 < s.t < 12]
    if case == "motion": samples = [s.model_copy(update={"r": s.r+(30 if s.t > 12 else 0)}) for s in samples]
    if case == "dark": samples = [s.model_copy(update={"r": 10, "g":5, "b":5}) for s in samples]
    if case == "clipped": samples = [s.model_copy(update={"r": 254}) for s in samples]
    if case == "uncovered": samples = [s.model_copy(update={"g": 180}) for s in samples]
    if case == "short": samples = waveform(duration=10)
    if case == "slow": samples = waveform(fps=10)
    if case == "duplicate": samples[100] = samples[99]
    if case == "fast_bpm": samples = waveform(210)
    if case == "slow_bpm": samples = waveform(35)
    if case == "changing": samples = [s if s.t < 12 else s.model_copy(update={"r":180+2*math.sin(2*math.pi*2*s.t)}) for s in samples]
    result = estimate_ppg(samples, torch_enabled=True)
    assert not result.valid and result.heart_rate is None and result.failure_reason


def test_no_torch_and_extreme_samples_rejected():
    assert estimate_ppg(waveform(), torch_enabled=False).failure_reason == "torch_unavailable"
    for value in (float("nan"), float("inf"), -1, 256):
        with pytest.raises(ValidationError):
            RGBSample(t=0, r=value, g=70, b=50)


def make_app(mode="mixed"):
    app = create_app(LLMSettings(), SensorSettings())
    app.state.demo, clock = runtime(mode)
    return app, clock


def measurement(app, clock, bpm=72, phase="pre"):
    return {"timestamp": clock.wall, "session_id": app.state.demo.session.control.session_id,
            "phase":phase, "torch_enabled":True, "samples":[s.model_dump() for s in waveform(bpm)]}


def test_ppg_http_pre_post_summary_stale_and_reset():
    app, clock = make_app()
    with TestClient(app) as client:
        clock.advance(26)
        pre = client.post('/api/sensor/ppg', json=measurement(app,clock,90)).json()
        assert pre["valid"] and pre["accepted"] and pre["sensor_status"]["heart_rate"]["source"] == "phone_ppg"
        with client.websocket_connect('/ws/control') as ws:
            frame = ControlFrame.model_validate(ws.receive_json())
            assert frame.data_source == "mixed" and frame.payload.signals.heart_rate == 90
        clock.advance(1)
        app.state.demo.current_frame()
        assert app.state.demo.session.engine.window[-1].heart_rate == 90
        clock.advance(25)
        post = client.post('/api/sensor/ppg', json=measurement(app,clock,72,'post')).json()
        assert post["accepted"]
        summary = client.get('/api/session/summary').json()
        assert summary["pre_ritual_hr"] == 90 and summary["post_ritual_hr"] == 72
        assert summary["delta_bpm"] == -18 and summary["data_source"] == "mixed"
        assert summary["pre_measurement"]["source"] == "phone_ppg"
        clock.advance(6)
        status = client.get('/api/sensor/status').json()
        assert status["heart_rate"]["source"] == "simulated" and status["effective_data_source"] == "simulated"
        assert client.get('/api/session/summary').json()["pre_ritual_hr"] == 90
        old = measurement(app,clock)
        client.post('/api/demo', json={"scenario":"calming"})
        assert client.get('/api/session/summary').json()["pre_ritual_hr"] is None
        assert client.get('/api/session/summary').json()["last_ppg_result"] is None
        assert client.post('/api/sensor/ppg', json=old).status_code == 409


def test_invalid_ppg_never_enters_buffer_and_simulated_mode_remains_simulated():
    app, clock = make_app("simulated")
    with TestClient(app) as client:
        clock.advance(26)
        body = measurement(app,clock)
        body["torch_enabled"] = False
        result = client.post('/api/sensor/ppg', json=body).json()
        assert not result["accepted"] and not result["valid"]
        assert client.get('/api/session/summary').json()["pre_ritual_hr"] is None
        body["torch_enabled"] = True
        result = client.post('/api/sensor/ppg', json=body).json()
        assert result["accepted"] and result["sensor_status"]["effective_data_source"] == "simulated"


@pytest.mark.parametrize("updates", [{"signal_quality":0.2},{"valid":False},{"duration_sec":10},{"heart_rate":210},{"session_id":None}])
def test_direct_phone_input_quality_gate(updates):
    body = dict(timestamp=1000, heart_rate=82, source="phone_ppg", signal_quality=0.8,
                duration_sec=25, session_id="session-test", measurement_phase="pre")
    with pytest.raises(ValidationError):
        HeartRateInput(**{**body, **updates})


def test_apple_bridge_adapter_is_optional_and_uses_existing_reading():
    r, clock = runtime()
    adapter = AppleWatchHeartRateAdapter(SensorSettings(), "watch", created_at=clock.wall,
        clock=clock.time, monotonic=clock.monotonic)
    with pytest.raises(InputRejected): adapter.accept(HeartRateInput(timestamp=clock.wall, heart_rate=78))
    adapter.accept(HeartRateInput(timestamp=clock.wall, heart_rate=78, source="apple_watch"))
    assert adapter.read(0,clock.wall).field_sources.heart_rate == "apple_watch"
    assert r.sensor_status()["effective_data_source"] == "simulated"


def test_reset_while_processing_cannot_apply_old_result(monkeypatch):
    app, clock = make_app()
    clock.advance(26)
    async def reset_then_compute(func, *args, **kwargs):
        app.state.demo.reset(DemoRequest(scenario="calming"))
        return func(*args, **kwargs)
    monkeypatch.setattr(endpoint, "run_in_threadpool", reset_then_compute)
    with TestClient(app) as client:
        assert client.post('/api/sensor/ppg', json=measurement(app,clock)).status_code == 409
        assert app.state.demo.session.measurements["pre"] is None


def test_demo_files_served_without_camera_side_effects():
    app, _ = make_app()
    with TestClient(app) as client:
        assert client.get('/tools/ppg-demo/').status_code == 200
        js = client.get('/tools/ppg-demo/app.js')
        assert js.status_code == 200 and 'getUserMedia' in js.text
        assert app.state.demo.started_at is None
