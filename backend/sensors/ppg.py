"""Short-window fingertip PPG prototype. No clinical confidence or HRV."""
import math
from statistics import mean, median, pstdev
from typing import Literal

from pydantic import Field

from backend.models import Model

MIN_QUALITY = 0.65


class RGBSample(Model):
    t: float = Field(ge=0, le=35, strict=True)
    r: float = Field(ge=0, le=255, strict=True)
    g: float = Field(ge=0, le=255, strict=True)
    b: float = Field(ge=0, le=255, strict=True)


class PPGRequest(Model):
    timestamp: float = Field(ge=0, strict=True, description="Window end, Unix seconds")
    session_id: str = Field(min_length=1, max_length=128)
    phase: Literal["pre", "post"]
    torch_enabled: bool = Field(strict=True)
    samples: list[RGBSample] = Field(min_length=2, max_length=1200)


class PPGResult(Model):
    valid: bool
    heart_rate: float | None = None
    signal_quality: float = Field(ge=0, le=1)
    duration_sec: float = Field(ge=0)
    source: Literal["phone_ppg"] = "phone_ppg"
    failure_reason: str | None = None
    diagnostics: dict[str, float | str] = Field(default_factory=dict)


def detrend(values):
    n = len(values)
    center = (n - 1) / 2
    average = mean(values)
    slope = sum((i - center) * (v - average) for i, v in enumerate(values)) / sum((i - center)**2 for i in range(n))
    residual = [v - average - slope * (i - center) for i, v in enumerate(values)]
    return [mean(residual[max(0, i-1):min(n, i+2)]) for i in range(n)]


def dominant(values, fps=30):
    """Bounded DFT search, including rejection bands outside accepted BPM."""
    n = len(values)
    windowed = [v * (0.5 - 0.5 * math.cos(2 * math.pi * i / (n-1))) for i, v in enumerate(values)]
    best, power = 0, -1
    for step in range(186):
        frequency = 0.4 + 0.02 * step
        angle = 2 * math.pi * frequency / fps
        real = sum(v * math.cos(angle*i) for i, v in enumerate(windowed))
        imag = sum(v * math.sin(angle*i) for i, v in enumerate(windowed))
        candidate = real*real + imag*imag
        if candidate > power:
            best, power = frequency, candidate
    angle = 2 * math.pi * best / fps
    real = sum(v * math.cos(angle*i) for i, v in enumerate(values))
    imag = sum(v * math.sin(angle*i) for i, v in enumerate(values))
    energy = sum(v*v for v in values)
    coherence = min(1, 2 * (real*real + imag*imag) / max(n * energy, 1e-12))
    return best, coherence


def estimate_ppg(samples: list[RGBSample], *, torch_enabled: bool) -> PPGResult:
    duration = max(0, samples[-1].t - samples[0].t) if len(samples) > 1 else 0

    diagnostics = {"algorithm": "linear-detrend-robust-step-v2", "min_quality": MIN_QUALITY}

    def invalid(reason, quality=0):
        return PPGResult(valid=False, signal_quality=round(quality, 3), duration_sec=round(duration, 3), failure_reason=reason, diagnostics=diagnostics)

    if not torch_enabled:
        return invalid("torch_unavailable")
    if not 20 <= duration <= 30.5 or len(samples) < 300:
        return invalid("insufficient_duration")
    intervals = [b.t-a.t for a, b in zip(samples, samples[1:])]
    diagnostics.update(actual_fps=(len(samples)-1)/duration, max_gap_sec=max(intervals),
                       interval_cv=pstdev(intervals)/mean(intervals))
    if min(intervals) <= 0 or max(intervals) > 0.25:
        return invalid("frame_interruption")
    if not 15 <= (len(samples)-1)/duration <= 65 or pstdev(intervals)/mean(intervals) > 0.35:
        return invalid("unstable_frame_rate")
    cover = mean(s.r > 40 and s.r > 1.15*s.g and s.r > 1.1*s.b for s in samples)
    diagnostics["coverage_fraction"] = cover
    if cover < 0.85:
        return invalid("finger_not_covered")
    red = [s.r for s in samples]
    diagnostics.update(red_mean=mean(red), red_min=min(red), red_max=max(red),
                       clipped_frame_fraction=mean(v >= 250 or v <= 5 for v in red),
                       first_last_mean_delta=mean(red[-60:])-mean(red[:60]))
    if diagnostics["clipped_frame_fraction"] > 0.05:
        return invalid("exposure_clipped")
    # Uniform grid from actual frame timestamps (never assume callback == 30 fps).
    values, j = [], 0
    for i in range(int(duration*30)+1):
        t = samples[0].t + i/30
        while j+1 < len(samples)-1 and samples[j+1].t < t:
            j += 1
        left, right = samples[j], samples[j+1]
        ratio = (t-left.t)/(right.t-left.t)
        values.append(left.r + ratio*(right.r-left.r))
    signal = detrend(values)
    amplitude = pstdev(signal)
    steps = [abs(b-a) for a,b in zip(values, values[1:])]
    step = max(steps)
    # A jump inflates whole-window STD; compare it with typical frame increments instead.
    step_limit = min(max(3, amplitude * 6), max(3, 12 * median(steps)))
    relative = amplitude / max(median(red), 1)
    diagnostics.update(residual_std=amplitude, relative_amplitude=relative, max_step=step,
                       relative_amplitude_limit=0.08, step_limit=step_limit, typical_step=median(steps), step_multiplier=12)
    if amplitude < 0.15:
        return invalid("signal_too_weak")
    if relative > 0.08 or step > step_limit:
        diagnostics["rejection_detail"] = "large_relative_amplitude" if relative > 0.08 else "abrupt_step"
        return invalid("motion_or_pressure_change")
    frequency, coherence = dominant(signal)
    bpm = frequency * 60
    diagnostics.update(dominant_frequency_hz=frequency, full_coherence=coherence)
    if not 45 <= bpm <= 180:
        return invalid("bpm_out_of_range")
    mid = len(signal)//2
    f1, c1 = dominant(detrend(values[:mid]))
    f2, c2 = dominant(detrend(values[mid:]))
    disagreement = abs(f1-f2)*60
    lag = round(30/frequency)
    left, right = signal[:-lag], signal[lag:]
    periodicity = max(0, min(1, sum(a*b for a,b in zip(left,right)) / max(math.sqrt(sum(a*a for a in left)*sum(b*b for b in right)), 1e-12)))
    quality = min(1, 0.5*coherence + 0.3*periodicity + 0.2*max(0, 1-disagreement/10))
    diagnostics.update(first_frequency_hz=f1, second_frequency_hz=f2, disagreement_bpm=disagreement,
                       disagreement_limit_bpm=8, first_coherence=c1, second_coherence=c2,
                       segment_coherence_min=0.4, full_coherence_min=0.45, periodicity=periodicity)
    if disagreement > 8 or min(c1, c2) < 0.4:
        diagnostics["rejection_detail"] = "segment_frequency_disagreement" if disagreement > 8 else "weak_segment_coherence"
        return invalid("inconsistent_pulse", quality)
    if coherence < 0.45 or quality < MIN_QUALITY:
        return invalid("low_signal_quality", quality)
    return PPGResult(valid=True, heart_rate=round(bpm, 1), signal_quality=round(quality, 3), duration_sec=round(duration, 3), diagnostics=diagnostics)
