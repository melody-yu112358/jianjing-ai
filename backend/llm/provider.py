"""Chat-completions-compatible HTTP adapter; no vendor SDK or fixed model."""
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

from backend.llm.base import LLMProvider
from backend.llm.prompts import SYSTEM_PROMPT
from backend.llm.validation import LLMOutput


@dataclass(frozen=True)
class LLMSettings:
    mode: str = "rule"
    base_url: str = ""
    api_key: str = field(default="", repr=False)
    model: str = ""
    timeout_sec: float = 3.0

    @classmethod
    def from_env(cls):
        mode = os.getenv("CONTROLLER_MODE", "rule")
        if mode not in ("rule", "mock_llm", "llm"):
            raise ValueError("CONTROLLER_MODE must be rule, mock_llm or llm")
        timeout = float(os.getenv("LLM_TIMEOUT_SEC", "3"))
        if not 0.05 <= timeout <= 10:
            raise ValueError("LLM_TIMEOUT_SEC must be between 0.05 and 10")
        return cls(mode, os.getenv("LLM_BASE_URL", ""), os.getenv("LLM_API_KEY", ""),
                   os.getenv("LLM_MODEL", ""), timeout)


class ChatCompletionsProvider(LLMProvider):
    def __init__(self, settings: LLMSettings, transport=None):
        self.settings, self.transport = settings, transport

    async def generate_decision(self, payload: dict) -> str:
        import json
        cfg = self.settings
        if not all((cfg.base_url, cfg.api_key, cfg.model)):
            raise ValueError("LLM configuration missing")
        parsed = urlparse(cfg.base_url)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")):
            raise ValueError("HTTPS required except for local testing")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Base URL must not contain credentials, query or fragment")
        body = {
            "model": cfg.model,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                         {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "ritual_action", "strict": True, "schema": LLMOutput.model_json_schema()}},
        }
        # Bounded whole-call timeout is also enforced by the controller. No retries.
        async with httpx.AsyncClient(timeout=cfg.timeout_sec, follow_redirects=False,
                                     trust_env=False, transport=self.transport) as client:
            async with client.stream("POST", cfg.base_url.rstrip("/") + "/chat/completions",
                    headers={"Authorization": "Bearer " + cfg.api_key}, json=body) as response:
                response.raise_for_status()
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 65536:
                        raise ValueError("Provider response too large")
        result = json.loads(content)
        return result["choices"][0]["message"]["content"]
