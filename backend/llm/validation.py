"""Strict provider wire schema and a conservative output-content gate."""
import json
import re
import unicodedata

from pydantic import Field, model_validator

from backend.models import Action, Model, Unit


class LLMOutput(Model):
    action: Action
    inhale_sec: float = Field(ge=0, le=5)
    exhale_sec: float = Field(ge=0, le=7)
    visual_intensity: Unit
    audio_intensity: Unit
    message: str = Field(min_length=1, max_length=25)
    reason: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def bounded_action(self):
        if self.action in ("continue_breathing", "slow_down"):
            if not (3 <= self.inhale_sec <= 5 and 4 <= self.exhale_sec <= 7
                    and self.exhale_sec >= self.inhale_sec):
                raise ValueError("Invalid breathing durations")
        elif self.inhale_sec != 0 or self.exhale_sec != 0:
            raise ValueError("Natural breathing must have zero timings")
        if self.action in ("end", "fade_out") and (self.visual_intensity or self.audio_intensity):
            raise ValueError("Ending actions must request zero stimulation")
        for value in (self.message, self.reason):
            normalized = unicodedata.normalize("NFKC", value)
            if not re.fullmatch(r"[\u4e00-\u9fff，。！？、；：,!?;:\s]+", normalized):
                raise ValueError("Only short Chinese prose is allowed")
            compact = re.sub(r"\s", "", normalized)
            if re.search(r"药|医|诊|病|疗|症|焦虑|抑郁|失眠|脑|神经|睡眠|睡着|入睡|深睡|"
                         r"心理|治愈|保证|必须|一定|屏息|屏住|憋气|深呼吸|用力|血压|心脏|激素|正常值", compact):
                raise ValueError("Non-wellness output rejected")
        return self


def parse_output(raw: str) -> LLMOutput:
    if not isinstance(raw, str) or len(raw) > 4096:
        raise ValueError("Invalid response size or type")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate key")
            result[key] = value
        return result
    value = json.loads(raw, object_pairs_hook=unique)
    return LLMOutput.model_validate(value, strict=True)
