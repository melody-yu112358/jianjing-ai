"""Session-owned projection and global v2 delivery sequence, with no sensor reads."""
from uuid import uuid4

from backend.control.models import ControlFrame, ControlPayload, DebugState, Guidance, MAX_SAFE_INTEGER
from backend.models import Frame
from backend.visual.mapper import map_visual


class ControlAdapter:
    def __init__(self):
        self.session_id = "session-" + str(uuid4())
        self.next_seq = 0
        self.visual = None
        self.fade_from = None
        self.fade_started = None

    def observe(self, frame: Frame, second: int, fade_seconds: int):
        if frame.ritual.stage == "fade_out" and self.fade_started is None:
            if self.visual is None:
                raise ValueError("Session must observe a pre-fade snapshot")
            self.fade_from = self.visual.model_copy(deep=True)
            self.fade_started = second
        progress = 0 if self.fade_started is None else (second - self.fade_started) / fade_seconds
        self.visual = map_visual(frame.state, frame.ritual, fade_from=self.fade_from, fade_progress=progress)

    def snapshot(self, frame: Frame, *, include_debug: bool = True) -> ControlFrame:
        if self.visual is None:
            raise ValueError("Observe the current frame before serializing")
        if self.next_seq > MAX_SAFE_INTEGER:
            raise OverflowError("Session sequence exhausted; reset required")
        packet = ControlFrame(session_id=self.session_id, seq=self.next_seq, timestamp=frame.timestamp,
            payload=ControlPayload(visual=self.visual.model_copy(deep=True),
                guidance=Guidance(text=frame.message, stage=frame.ritual.stage,
                                  inhale_sec=frame.ritual.inhale_sec, exhale_sec=frame.ritual.exhale_sec),
                signals=frame.signals if include_debug else None,
                state=DebugState(**frame.state.model_dump(include={"arousal", "stability", "trend"})) if include_debug else None))
        self.next_seq += 1
        return packet
