import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from jsonschema import validate

from backend.explainability import ExplainabilitySnapshot, demo_baseline, snapshot
from backend.main import create_app
from backend.models import DemoRequest, RitualDecision
from backend.session import Session, DemoRuntime
from backend.llm.controller import LLMController
from backend.llm.mock import MockLLMProvider
from backend.llm.provider import LLMSettings


def test_read_only_contract_pending_and_schema():
    app = create_app(LLMSettings(mode="rule"))
    with TestClient(app) as client:
        first = client.get('/api/explainability').json()
        for _ in range(4):
            assert client.get('/api/explainability').json() == first
        assert app.state.demo.session.second == -1
        assert app.state.demo.started_at is None
        assert first['current_state'] is None and first['decision_trace'] is None
        assert first['provenance']['decision_source'] is None
        validate(first, client.get('/api/schema/explainability').json())
        assert client.get('/api/schema/explainability').json() == ExplainabilitySnapshot.model_json_schema()


def test_baseline_deterministic_provenance_and_no_mutable_sharing():
    a,b=demo_baseline(),demo_baseline()
    assert a == b and a.arousal == .46 and a.stability == .67
    assert len(a.history) == 7 and a.source == 'simulated_demo_history'
    a.history[0].arousal = 0
    assert demo_baseline() == b


@pytest.mark.parametrize('report', ['mind_racing','body_tense','tired_but_awake','already_sleepy'])
def test_state_decision_and_response_are_exact_session_projections(report):
    session=Session(DemoRequest(scenario='calming',self_report=report))
    for second in range(181):
        frame=session.advance_to(second,1000+second)
        s=snapshot(session)
        validate(s.model_dump(),ExplainabilitySnapshot.model_json_schema())
        assert s.current_state == frame.state
        assert s.decision_trace.decision.as_ritual() == frame.ritual
        assert s.decision_trace.decision.message == frame.message
        assert s.decision_trace.observation == session.last_consumed_reading.signals()
        assert s.provenance.decision_source == 'rule'
        assert s.provenance.baseline_source == 'simulated_demo_history'
        assert s.session_signal_baseline == session.engine.baseline
        assert s.self_report == report
        assert len(s.decision_history)<=32
        before=(session.second,len(session.engine.history),session.control.next_seq)
        assert snapshot(session)==s
        assert (session.second,len(session.engine.history),session.control.next_seq)==before
    assert s.decision_trace.decision.action == 'end'


def test_reset_isolation_and_discomfort():
    runtime=DemoRuntime(LLMSettings())
    old=runtime.session
    old.advance_to(40,1040)
    old_snapshot=snapshot(old)
    runtime.reset(DemoRequest(scenario='already_sleepy'))
    new=snapshot(runtime.session)
    assert new.session_id != old_snapshot.session_id
    assert new.decision_history == [] and new.current_state is None
    assert new.tonight_plan.initial_decision is None
    runtime.session.advance_to(10,1050)
    runtime.session.stop_for_discomfort(1050.5)
    stop=snapshot(runtime.session)
    assert stop.decision_trace.decision.action=='end'
    assert stop.current_state.reason_codes==['user_reported_discomfort']
    assert stop.provenance.decision_source=='rule'
    assert snapshot(old)==old_snapshot


class Invalid:
    async def generate_decision(self,payload): return '{}'


class Timeout:
    async def generate_decision(self,payload):
        await asyncio.sleep(1)
        return '{}'


@pytest.mark.parametrize('provider',[None,Invalid(),Timeout()])
def test_missing_config_invalid_timeout_execute_rule(provider):
    controller=LLMController(provider,LLMSettings(mode='llm',timeout_sec=.05))
    session=Session(DemoRequest(scenario='calming'),controller)
    session.advance_to(12,1012)
    s=snapshot(session)
    assert controller.failures>=1
    assert s.provenance.decision_source=='rule'
    assert s.decision_trace.decision_source=='rule'


def test_async_pending_adoption_and_safety_sources():
    async def run():
        controller=LLMController(MockLLMProvider(),LLMSettings(mode='mock_llm'))
        session=Session(DemoRequest(scenario='calming'),controller)
        session.advance_to(9,1009)
        assert snapshot(session).provenance.decision_source=='rule'
        await controller.task
        session.advance_to(10,1010)
        adopted=snapshot(session)
        assert adopted.provenance.decision_source=='mock_llm'
        assert adopted.decision_trace.decision_source=='mock_llm'
        assert RitualDecision.model_validate(adopted.decision_trace.decision.model_dump())
        session.stop_for_discomfort(1010.5)
        assert snapshot(session).provenance.decision_source=='rule'
    asyncio.run(run())


def test_both_websocket_versions_still_project_same_runtime():
    app=create_app(LLMSettings())
    with TestClient(app) as c:
        with c.websocket_connect('/ws/control') as ws:
            control=ws.receive_json()
            s=c.get('/api/explainability').json()
            assert control['version']=='2.0'
            assert control['session_id']==s['session_id']
            assert control['payload']['guidance']['text']==s['decision_trace']['decision']['message']
        with c.websocket_connect('/ws/state') as ws:
            frame=ws.receive_json()
            s=c.get('/api/explainability').json()
            assert frame['state']==s['current_state']
            assert frame['ritual']['action']==s['decision_trace']['decision']['action']


def test_provider_identity_not_mode_labels_mock_as_llm():
    controller=LLMController(MockLLMProvider(),LLMSettings(mode='llm'))
    session=Session(DemoRequest(scenario='calming'),controller)
    session.advance_to(10,1010)
    assert snapshot(session).provenance.decision_source=='mock_llm'


def test_successful_http_adapter_adoption_is_llm():
    import httpx
    from backend.llm.provider import ChatCompletionsProvider
    output=dict(action='continue_breathing',inhale_sec=4,exhale_sec=6,
        visual_intensity=.4,audio_intensity=.3,message='按舒服的节奏呼吸。',reason='先尝试轻柔的引导。')
    cfg=LLMSettings(mode='llm',base_url='https://provider.example/v1',api_key='test',model='test')
    provider=ChatCompletionsProvider(cfg,httpx.MockTransport(lambda req:
        httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(output)}}]})))
    session=Session(DemoRequest(scenario='calming'),LLMController(provider,cfg))
    session.advance_to(10,1010)
    s=snapshot(session)
    assert s.provenance.decision_source=='llm'
    assert s.decision_trace.decision.message==output['message']
    assert s.decision_trace.decision.reason==output['reason']


def test_committed_schema_and_example_are_current():
    from pathlib import Path
    schema=json.loads(Path('docs/explainability.schema.json').read_text())
    assert schema == ExplainabilitySnapshot.model_json_schema()
    example=json.loads(Path('docs/explainability.example.json').read_text())
    validate(example,schema)
    session=Session(DemoRequest(scenario='not_responding',self_report='mind_racing'))
    session.advance_to(39,1700000039)
    actual=snapshot(session).model_dump()
    actual['session_id']=example['session_id']
    assert actual==example
