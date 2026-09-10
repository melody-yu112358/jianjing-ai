from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @abstractmethod
    async def generate_decision(self, payload: dict) -> str:
        """Return raw JSON text. Parsing and validation belong to the controller."""
