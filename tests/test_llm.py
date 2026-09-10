import asyncio
from dataclasses import replace
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.llm.base import LLMProvider
from backend.llm.controller import LLMController
from backend.llm.mock import MockLLMProvider
from backend.llm.provider import ChatCompletionsProvider, LLMSettings
from backend.main import create_app
from backend.models import DemoRequest, Frame, RitualDecision, State
from backend.ritual.controller import ControllerContext, DecisionRecord, RuleBasedController
from backend.session import DemoRuntime, Session


def state(**changes):
    return State(**dict(dict(arousal=0.71, stability=0.42, trend="flat",
        state_class="not_responding", confidence=0.81,
        reason_codes=["rolling_trend_flat", "no_improvement_after_intervention"]), **changes))


def context(**changes):
    return replace(ControllerContext(second=39, self_report="mind_racing", baseline_ready=True,
        stage="guided_breathing", stage_started=9, last_decision=9,
        intervention_started=9, previous_action="continue_breathing"), **changes)


def output(**changes):
    return dict(dict(action="switch_to_grounding", inhale_sec=0, exhale_sec=0,
        visual_intensity=0.42, audio_intensity=0.35,
        message="不用控制呼吸，先听一会儿声音就好。", reason="连续一轮没有明显趋稳，先降低任务感。"), **changes)


class Stub(LLMProvider):
    def __init__(self, raw=None, delay=0, error=None):
        self.raw = json.dumps(output(), ensure_ascii=False) if raw is None else raw
        self.delay, self.error, self.calls, self.payloads = delay, error, 0, []

    async def generate_decision(self, payload):
        self.calls += 1
        self.payloads.append(payload)
        await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.raw


@pytest.mark.parametrize("scenario", ["calming", "not_responding", "already_sleepy"])
def test_rule_mode_full_trajectory_unchanged(scenario):
    runtime = DemoRuntime(LLMSettings(mode="rule"))
    runtime.reset(DemoRequest(scenario=scenario))
    expected = Session(DemoRequest(scenario=scenario))
    for second in range(181):
        assert runtime.session.advance_to(second, second) == expected.advance_to(second, second)


def test_mock_valid_nonresponse_switch_and_payload_only_processed():
    provider = Stub()
    controller = LLMController(provider, LLMSettings(mode="llm"))
    ctx = context(recent_decisions=(DecisionRecord("continue_breathing", "activated"),))
    result = controller.decide(state(), ctx)
    assert result.action == "switch_to_grounding" and result.stage == "switch_method"
    assert RitualDecision.model_validate_json(result.model_dump_json()) == result
    assert set(provider.payloads[0]) == {"self_report", "state_class", "arousal", "stability", "trend",
        "confidence", "reason_codes", "previous_action", "elapsed_intervention_sec", "previous_stage", "recent_decisions"}
    assert provider.payloads[0]["elapsed_intervention_sec"] == 30
    assert "signals" not in json.dumps(provider.payloads[0])
    mock = LLMController(MockLLMProvider(), LLMSettings(mode="mock_llm"))
    assert mock.decide(state(), context(previous_action="switch_to_grounding")).action == "switch_to_natural_breathing"


@pytest.mark.parametrize("raw", [
    "not json", "```json\n{}\n```", "[]", "null", "{}",
    '{"action":"end","action":"continue_breathing"}',
    json.dumps(output(action="invented")), json.dumps(output(visual_intensity=1.2)),
    json.dumps(output(audio_intensity=-0.1)), json.dumps(output(inhale_sec=999)),
    json.dumps(output(inhale_sec="0")), json.dumps(output(audio_intensity=True)),
    json.dumps(output(visual_intensity=float("nan"))), json.dumps(output(extra="bad")),
    json.dumps({k:v for k,v in output().items() if k != "reason"}),
    json.dumps(output(message="你已经进入睡眠。")), json.dumps(output(message="建议服用安眠药。")),
    json.dumps(output(reason="你的脑区已经恢复正常。")), json.dumps(output(message="平" * 26)),
    json.dumps(output(action="continue_breathing", inhale_sec=4, exhale_sec=6)),
    json.dumps(output(action="fade_out", visual_intensity=0, audio_intensity=0)),
])
def test_invalid_output_falls_back(raw):
    controller = LLMController(Stub(raw), LLMSettings(mode="llm"))
    assert controller.decide(state(), context()) == RuleBasedController().decide(state(), context())
    assert controller.failures == 1 and controller.last_source == "fallback"


@pytest.mark.parametrize("provider", [Stub(delay=1), Stub(error=RuntimeError("unavailable"))])
def test_timeout_and_unavailable_fall_back(provider):
    controller = LLMController(provider, LLMSettings(mode="llm", timeout_sec=0.05))
    assert controller.decide(state(), context()) == RuleBasedController().decide(state(), context())
    assert controller.failures == 1


@pytest.mark.parametrize("s,c", [
    (state(state_class="discomfort"), context()),
    (state(state_class="ready_to_disengage", confidence=0.9,
           reason_codes=["stable_for_two_windows", "disengagement_criteria_met"]), context()),
    (state(), context(self_report="already_sleepy")),
    (state(), context(stage="end")),
    (state(), context(baseline_ready=False)),
])
def test_hard_guards_skip_provider(s, c):
    provider = Stub()
    result = LLMController(provider).decide(s, c)
    assert provider.calls == 0
    assert result == RuleBasedController().decide(s, c)


def test_ready_without_evidence_does_not_fade():
    provider = Stub()
    result = LLMController(provider).decide(state(state_class="ready_to_disengage", confidence=0.1), context())
    assert provider.calls == 0 and result.stage != "fade_out"


def test_async_does_not_block_and_discomfort_cancels_late_answer():
    async def run():
        provider = Stub(delay=0.2)
        controller = LLMController(provider)
        result = controller.decide(state(), context())
        assert result == RuleBasedController().decide(state(), context())
        task = controller.task
        await asyncio.sleep(0)
        assert provider.calls == 1 and not task.done()
        stop = controller.decide(state(state_class="discomfort"), context(second=40))
        assert stop.stage == "end" and stop.audio_intensity == 0
        await asyncio.gather(task, return_exceptions=True)
        assert task.cancelled() and controller.cached is None
    asyncio.run(run())


def test_async_result_applies_and_is_not_retried_each_second():
    async def run():
        provider = Stub()
        controller = LLMController(provider)
        controller.decide(state(), context())
        await controller.task
        result = controller.decide(state(), context(second=40))
        assert result.message == output()["message"]
        for t in range(41, 69):
            controller.decide(state(), context(second=t))
        assert provider.calls == 1
        controller.cancel()
    asyncio.run(run())


def test_late_training_response_is_rejected_if_state_changed():
    async def run():
        provider = Stub(json.dumps(output(action="continue_breathing", inhale_sec=4, exhale_sec=6)))
        controller = LLMController(provider)
        controller.decide(state(state_class="activated"), context())
        await controller.task
        result = controller.decide(state(), context(second=40))
        assert result.action not in ("continue_breathing", "slow_down")
    asyncio.run(run())


def test_session_memory_is_bounded_and_reset_cancels_pending():
    async def run():
        runtime = DemoRuntime(LLMSettings(mode="mock_llm"))
        for second in range(70):
            runtime.session.advance_to(second, second)
            if runtime.session.controller.task:
                await runtime.session.controller.task
            assert len(runtime.session.context.recent_decisions) <= 3
        assert len(runtime.session.context.recent_decisions) == 3
        old = runtime.session
        old.controller.provider = Stub(delay=1)
        old.controller.request_second = -100
        old.advance_to(70, 70)
        task = old.controller.task
        runtime.reset(DemoRequest(scenario="calming"))
        assert runtime.session.context.recent_decisions == ()
        if task:
            await asyncio.gather(task, return_exceptions=True)
            assert task.cancelled()
    asyncio.run(run())


@pytest.mark.parametrize("mode", ["rule", "mock_llm", "llm"])
def test_modes_and_unchanged_websocket_schema(mode):
    with TestClient(create_app(LLMSettings(mode=mode))) as client:
        assert client.get("/api/controller").json()["mode"] == mode
        with client.websocket_connect("/ws/state") as ws:
            assert Frame.model_validate(ws.receive_json()).ritual.stage == "assess"
        assert client.get("/api/schema/state").json() == Frame.model_json_schema()


def test_real_http_adapter_contract_and_no_secrets_in_repr():
    settings = LLMSettings(mode="llm", base_url="https://provider.example/v1", api_key="test-only-value", model="test-model")
    assert settings.api_key not in repr(settings)
    def handler(request):
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-only-value"
        body = json.loads(request.content)
        assert body["model"] == "test-model"
        assert body["response_format"]["json_schema"]["strict"] is True
        assert "signals" not in json.loads(body["messages"][1]["content"])
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(output())}}]})
    provider = ChatCompletionsProvider(settings, transport=httpx.MockTransport(handler))
    assert LLMController(provider, settings).decide(state(), context()).action == "switch_to_grounding"


@pytest.mark.parametrize("status", [401, 429, 500, 503])
def test_http_errors_fall_back_without_logging_response(status, caplog):
    settings = LLMSettings(mode="llm", base_url="https://provider.example/v1", api_key="private-test-value", model="test")
    provider = ChatCompletionsProvider(settings, httpx.MockTransport(lambda request: httpx.Response(status, text="private-test-value")))
    controller = LLMController(provider, settings)
    assert controller.decide(state(), context()) == RuleBasedController().decide(state(), context())
    assert "private-test-value" not in caplog.text


def test_environment_default_and_explicit_modes(monkeypatch):
    for key in ("CONTROLLER_MODE", "LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_TIMEOUT_SEC"):
        monkeypatch.delenv(key, raising=False)
    assert LLMSettings.from_env() == LLMSettings()
    for mode in ("rule", "mock_llm", "llm"):
        monkeypatch.setenv("CONTROLLER_MODE", mode)
        assert DemoRuntime().controller_status()["mode"] == mode
    monkeypatch.setenv("CONTROLLER_MODE", "typo")
    with pytest.raises(ValueError):
        LLMSettings.from_env()


def test_sleepy_full_llm_path_never_calls_provider_or_forces_training():
    provider = Stub(json.dumps(output(action="continue_breathing", inhale_sec=4, exhale_sec=6)))
    session = Session(DemoRequest(scenario="already_sleepy"), LLMController(provider))
    frames = [session.advance_to(second, second) for second in range(60)]
    assert provider.calls == 0
    assert all(frame.ritual.stage != "guided_breathing" for frame in frames)
    assert any(frame.ritual.stage == "fade_out" for frame in frames[:45])
    assert frames[-1].ritual.stage == "end"
