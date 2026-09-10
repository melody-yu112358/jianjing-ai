import json

from backend.llm.base import LLMProvider


class MockLLMProvider(LLMProvider):
    """Deterministic local provider exercising the same validation path."""
    async def generate_decision(self, payload: dict) -> str:
        state = payload["state_class"]
        if state == "not_responding":
            previous = payload["previous_action"]
            action = "switch_to_natural_breathing" if previous == "switch_to_grounding" else "switch_to_grounding"
            message = "不必控制呼吸，先听一会儿声音就好。" if action == "switch_to_grounding" else "不用跟着节奏，自然呼吸就好。"
        elif state in ("settling", "stable"):
            action, message = "reduce_stimulation", "保持舒服的节奏，让提示轻一点。"
        else:
            action, message = "continue_breathing", "轻轻呼吸，按舒服的节奏就好。"
        return json.dumps({"action": action, "inhale_sec": 4 if action == "continue_breathing" else 0,
            "exhale_sec": 6 if action == "continue_breathing" else 0,
            "visual_intensity": 0.4, "audio_intensity": 0.3, "message": message,
            "reason": "结合当前趋势，选择更轻的引导。"}, ensure_ascii=False)
