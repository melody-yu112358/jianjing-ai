"""Pure mappings of processed state + finite actions to artistic controls.

Fade origin/progress are explicit inputs supplied by the session adapter.
No LLM intensity, raw signals, wall clock or random source is used here.
"""
from backend.control.models import VisualControl
from backend.models import Ritual, State
from backend.state.arousal import clamp

ENERGY_FIELDS = ("intensity", "noise", "speed", "deformation", "frequency", "turbulence",
                 "particle_density", "particle_spread", "line_density", "line_activity", "glow", "pulse")


def map_visual(state: State, ritual: Ritual, *, fade_from: VisualControl | None = None,
               fade_progress: float = 0) -> VisualControl:
    if ritual.stage == "end" or state.state_class == "discomfort":
        return VisualControl(mode="serenity", **dict.fromkeys(ENERGY_FIELDS, 0), hue=200, transition_sec=0.1)
    if ritual.stage == "fade_out":
        if fade_from is None:
            raise ValueError("Fade requires the session's preceding visual snapshot")
        factor = 1 - clamp(fade_progress)
        values = fade_from.model_dump()
        values.update({key: getattr(fade_from, key) * factor for key in ENERGY_FIELDS})
        values["transition_sec"] = 1.0
        return VisualControl(**values)

    a, stability = state.arousal, state.stability
    uncertainty = 1 - stability
    guided = ritual.stage == "guided_breathing"
    gentle = ritual.stage in ("settling", "switch_method") or ritual.action == "reduce_stimulation"
    intensity = (0.16 + 0.64 * a) * (0.55 if gentle else 1)
    if ritual.action == "slow_down":
        intensity *= 0.8
    movement = 0.8 if state.trend == "down" else 1
    # Modes depend on action, stage AND continuous controls, not state-class labels.
    if ritual.action == "switch_to_grounding":
        mode = "ripple"
    elif gentle or (a < 0.45 and stability > 0.6):
        mode = "serenity"
    elif guided:
        mode = "pulse"
    elif a > 0.85 and stability < 0.25:
        mode = "storm"
    elif a > 0.65 and state.trend == "up":
        mode = "fold"
    else:
        mode = "ripple"
    values = dict(
        intensity=intensity,
        noise=intensity * uncertainty * 0.7,
        speed=intensity * (0.25 + 0.55 * a) * movement,
        deformation=intensity * (0.3 + 0.5 * a),
        frequency=intensity * (0.35 + 0.4 * a),
        turbulence=intensity * uncertainty * 0.55,
        particle_density=intensity * (0.3 + 0.4 * a),
        particle_spread=intensity * (0.2 + 0.5 * uncertainty),
        line_density=intensity * (0.3 + 0.3 * a),
        line_activity=intensity * (0.2 + 0.6 * uncertainty) * movement,
        glow=intensity * 0.7,
        # This is amplitude. The frontend uses guidance's inhale/exhale for phase.
        pulse=intensity * (0.45 if guided and ritual.inhale_sec > 0 and ritual.exhale_sec > 0 else 0.1),
    )
    return VisualControl(mode=mode, **{key: clamp(value) for key, value in values.items()},
                         hue=190 + 20 * stability, transition_sec=3.5 if gentle else 2.5)
