"""Nonblocking LLM orchestration with hard guards and validated rule fallback."""
import asyncio
from dataclasses import asdict
import logging

from backend.config import CONTROLLER_CONFIG
from backend.llm.provider import ChatCompletionsProvider, LLMSettings
from backend.llm.mock import MockLLMProvider
from backend.llm.validation import parse_output
from backend.models import RitualDecision
from backend.ritual.controller import RitualController, RuleBasedController

logger = logging.getLogger(__name__)


class LLMController(RitualController):
    def __init__(self, provider=None, settings=None, config=CONTROLLER_CONFIG):
        super().__init__(config)
        self.settings = settings or LLMSettings.from_env()
        self.provider = provider or ChatCompletionsProvider(self.settings)
        self.fallback = RuleBasedController(config)
        self.task = None
        self.cached = None
        self.request_second = -config.decision_seconds
        self.last_source = "rule"
        self.executed_source = "rule"
        self.last_error = None
        self.calls = self.successes = self.failures = 0

    def cancel(self):
        if self.task is not None:
            self.task.cancel()
        self.task = None
        self.cached = None

    def guarded(self, state, ctx):
        return (state.state_class in ("discomfort", "ready_to_disengage")
                or not ctx.baseline_ready or ctx.stage in ("fade_out", "end")
                or ctx.self_report == "already_sleepy"
                or ctx.second >= self.config.max_seconds - self.config.fade_seconds)

    def payload(self, state, ctx):
        return {"self_report": ctx.self_report, **state.model_dump(),
                "previous_action": ctx.previous_action,
                "elapsed_intervention_sec": 0 if ctx.intervention_started is None else ctx.second - ctx.intervention_started,
                "previous_stage": ctx.stage,
                "recent_decisions": [asdict(item) for item in ctx.recent_decisions[-3:]]}

    def validate(self, raw, state, ctx):
        output = parse_output(raw)
        breathing = output.action in ("continue_breathing", "slow_down")
        if breathing and (ctx.self_report == "already_sleepy" or state.state_class == "not_responding"
                          or ctx.stage in ("settling", "switch_method")):
            raise ValueError("Cannot reintroduce breathing tasks")
        # State evidence, not a model assertion, controls fade eligibility.
        if output.action == "fade_out":
            if state.state_class != "ready_to_disengage" or state.confidence < 0.65:
                raise ValueError("Insufficient evidence for early fade")
        stage = {"continue_breathing": "guided_breathing", "slow_down": "guided_breathing",
                 "reduce_stimulation": "settling", "switch_to_natural_breathing": "switch_method",
                 "switch_to_grounding": "switch_method", "fade_out": "fade_out", "end": "end"}[output.action]
        return RitualDecision(stage=stage, **output.model_dump())

    async def resolve(self, state, ctx):
        try:
            raw = await asyncio.wait_for(self.provider.generate_decision(self.payload(state, ctx)),
                                         timeout=self.settings.timeout_sec)
            decision = self.validate(raw, state, ctx)
            self.successes += 1
            self.last_error = None
            return decision
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.failures += 1
            # Never log exception text, headers, keys, prompts or response bodies.
            self.last_error = type(error).__name__
            logger.warning("LLM fallback (%s)", self.last_error)
            return None

    def decide(self, state, context) -> RitualDecision:
        # Execution provenance is separate from pending/fallback/safety diagnostics.
        self.executed_source = "rule"
        ctx = context
        evidence = (state.confidence >= 0.65 and "disengagement_criteria_met" in state.reason_codes
                    and "stable_for_two_windows" in state.reason_codes)
        effective = state
        if state.state_class == "ready_to_disengage" and not evidence:
            effective = state.model_copy(update={"state_class": "stable"})
        rule = self.fallback.decide(effective, ctx)
        if self.guarded(state, ctx):
            self.cancel()
            self.last_source = "safety"
            return rule
        if self.task is not None and self.task.done():
            result = self.task.result()
            self.task = None
            if result is not None:
                try:
                    # Recheck against CURRENT state, not only the request snapshot.
                    raw = result.model_dump_json(exclude={"stage"})
                    self.cached = self.validate(raw, state, ctx)
                except ValueError:
                    self.cached = None
            else:
                self.cached = None
        due = ctx.second - self.request_second >= self.config.decision_seconds
        if due and self.task is None:
            self.request_second = ctx.second
            self.calls += 1
            self.cached = None
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                self.cached = asyncio.run(self.resolve(state, ctx))
            else:
                self.task = loop.create_task(self.resolve(state.model_copy(deep=True), ctx))
        if self.cached is not None:
            try:
                self.cached = self.validate(self.cached.model_dump_json(exclude={"stage"}), state, ctx)
            except ValueError:
                self.cached = None
        if self.cached is not None:
            self.last_source = "mock_llm" if isinstance(self.provider, MockLLMProvider) else "llm"
            self.executed_source = self.last_source
            return self.cached
        self.last_source = "pending" if self.task is not None else "fallback"
        return rule
