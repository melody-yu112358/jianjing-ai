"""CLI receiver and real-network verification; no frontend required."""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import httpx
from websockets.asyncio.client import connect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.models import Frame


async def collect(base: str, scenario: str, report: str | None, samples: int):
    async with httpx.AsyncClient(trust_env=False) as client:
        response = await client.post(base + "/api/demo", json={"scenario": scenario, "self_report": report})
        response.raise_for_status()
    uri = base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/ws/state"
    frames, arrivals = [], []
    async with connect(uri, proxy=None) as ws:
        for i in range(samples):
            frame = Frame.model_validate_json(await asyncio.wait_for(ws.recv(), timeout=5))
            frames.append(frame)
            arrivals.append(time.monotonic())
            print(f"{scenario:14} t={i:3} HR={frame.signals.heart_rate:5.1f} "
                  f"RESP={frame.signals.resp_rate:4.1f} arousal={frame.state.arousal:.3f} "
                  f"trend={frame.state.trend:4} class={frame.state.state_class} "
                  f"confidence={frame.state.confidence:.3f} stage={frame.ritual.stage} "
                  f"action={frame.ritual.action}", flush=True)
    gaps = [b - a for a, b in zip(arrivals, arrivals[1:])]
    assert all(b.timestamp > a.timestamp for a, b in zip(frames, frames[1:])), "Timestamp did not increase"
    if gaps:
        assert 0.8 < sum(gaps) / len(gaps) < 1.3, "Average push interval is not approximately 1 second"
    return frames


async def main(args):
    if args.verify:
        if args.samples < 45:
            raise ValueError("--verify requires --samples >= 45 to observe the second decision")
        results = {}
        for scenario in ("calming", "not_responding"):
            frames = await collect(args.base_url, scenario, "mind_racing", args.samples)
            change = frames[-1].state.arousal - frames[0].state.arousal
            stages = sorted({f.ritual.stage for f in frames})
            results[scenario] = {"samples": len(frames), "arousal_start": frames[0].state.arousal,
                                 "arousal_end": frames[-1].state.arousal, "change": round(change, 3),
                                 "stages": stages}
            if scenario == "calming":
                assert change < -0.2 and "settling" in stages
            else:
                assert change > -0.03 and "switch_method" in stages
        print(json.dumps(results, indent=2))
    else:
        await collect(args.base_url, args.scenario, args.self_report, args.samples)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--scenario", choices=["calming", "not_responding", "already_sleepy"], default="calming")
    parser.add_argument("--self-report", choices=["mind_racing", "body_tense", "tired_but_awake", "already_sleepy"])
    parser.add_argument("--samples", type=int, default=60)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.samples < 1:
        parser.error("--samples must be positive")
    asyncio.run(main(args))
