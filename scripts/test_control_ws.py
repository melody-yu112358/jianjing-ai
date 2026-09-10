"""v2 receiver and real-network verification; --verify resets demo sessions."""
import argparse
import asyncio
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from jsonschema import Draft202012Validator
from websockets.asyncio.client import connect

from backend.control.models import ControlFrame
from backend.llm.provider import LLMSettings
from backend.main import create_app
from backend.models import Frame

ROOT = Path(__file__).resolve().parents[1]


def websocket_url(base, path):
    return base.rstrip("/").replace("https://", "wss://", 1).replace("http://", "ws://", 1) + path


async def collect(base, scenario, samples, validators, quiet=False, verify=False):
    frames, arrivals = [], []

    def validate(raw):
        assert len(raw.encode("utf-8")) <= 65536
        value = json.loads(raw)
        for validator in validators:
            validator.validate(value)
        packet = ControlFrame.model_validate(value)
        assert time.time() - 15 <= packet.timestamp <= time.time() + 5
        assert packet.data_source == "simulated"
        return packet

    async with httpx.AsyncClient(trust_env=False) as client:
        if scenario:
            response = await client.post(base + "/api/demo", json={"scenario": scenario})
            response.raise_for_status()
        async with connect(websocket_url(base, "/ws/control"), proxy=None) as ws:
            # A second protocol must not alter sampling or appear on this socket.
            async with connect(websocket_url(base, "/ws/state"), proxy=None) as old:
                for _ in range(samples):
                    packet = validate(await asyncio.wait_for(ws.recv(), 3))
                    legacy = Frame.model_validate_json(await asyncio.wait_for(old.recv(), 3))
                    frames.append(packet)
                    arrivals.append(time.monotonic())
                    p = packet.payload
                    if not quiet:
                        print(f"{packet.session_id} seq={packet.seq} mode={p.visual.mode} "
                              f"intensity={p.visual.intensity:.3f} stage={p.guidance.stage} {p.guidance.text}", flush=True)
                assert set(legacy.model_dump()) == {"timestamp", "signals", "state", "ritual", "visual", "message"}
            assert len({f.session_id for f in frames}) == 1
            assert all(b.seq > a.seq and b.timestamp > a.timestamp for a, b in zip(frames, frames[1:]))
            if scenario:
                assert frames[0].seq == 0
            average = (arrivals[-1] - arrivals[0]) / max(samples - 1, 1)
            if samples > 1:
                assert 0.8 < average < 1.3
            if verify:
                stages = {f.payload.guidance.stage for f in frames}
                if scenario == "not_responding":
                    assert "switch_method" in stages
                    assert frames[10].payload.visual.mode != frames[-1].payload.visual.mode
                else:
                    assert {"fade_out", "end"} <= stages
                    fade = [f.payload.visual.intensity for f in frames if f.payload.guidance.stage == "fade_out"]
                    assert fade[0] > fade[-1] > 0 and fade == sorted(fade, reverse=True)
                    assert frames[-1].payload.visual.intensity == frames[-1].payload.visual.noise == frames[-1].payload.visual.speed == 0
                if scenario == "calming":
                    assert frames[60].payload.visual.intensity < frames[10].payload.visual.intensity
                if scenario == "already_sleepy":
                    assert "guided_breathing" not in stages and frames[9].payload.visual.intensity < 0.25
                previous_id = frames[-1].session_id
                (await client.post(base + "/api/demo", json={"scenario": "calming"})).raise_for_status()
                for _ in range(3):
                    fresh = validate(await asyncio.wait_for(ws.recv(), 3))
                    if fresh.session_id != previous_id:
                        break
                assert fresh.session_id != previous_id and fresh.seq == 0
                stop = await client.post(base + "/api/feedback", json={"event": "discomfort"})
                stop.raise_for_status()
                for _ in range(3):
                    stopped = validate(await asyncio.wait_for(ws.recv(), 3))
                    if stopped.payload.guidance.stage == "end":
                        break
                assert stopped.payload.guidance.stage == "end" and stopped.payload.visual.intensity == 0
                async with connect(websocket_url(base, "/ws/control?debug=false"), proxy=None) as compact:
                    raw = await compact.recv()
                    validate(raw)
                    assert "state" not in json.loads(raw)["payload"] and "signals" not in json.loads(raw)["payload"]
    return {"scenario": scenario, "frames": samples, "mean_interval": round(average, 3),
            "stages": sorted({f.payload.guidance.stage for f in frames}),
            "intensity_start": round(frames[0].payload.visual.intensity, 3),
            "intensity_end": round(frames[-1].payload.visual.intensity, 3),
            "reset_stop_compact": "passed" if verify else "not requested"}


async def main(args):
    paths = [ROOT / "docs/agent-control-v2.schema.json"]
    if args.frontend_schema:
        paths.append(Path(args.frontend_schema))
    validators = []
    for path in paths:
        schema = json.loads(path.read_text(encoding="utf-8-sig"))
        Draft202012Validator.check_schema(schema)
        validators.append(Draft202012Validator(schema))
    scenarios = [("calming", 90), ("not_responding", 45), ("already_sleepy", 55)]
    if args.local:
        # Reuse the existing local server lifecycle helper; each scenario isolated.
        from test_phase3_live import start
        running = []
        try:
            for _ in scenarios:
                running.append(await start(create_app(LLMSettings(mode="rule"))))
            results = await asyncio.gather(*(collect(f"http://127.0.0.1:{server[3]}", scenario,
                count, validators, args.quiet, True) for (scenario, count), server in zip(scenarios, running)))
        finally:
            for server, task, sock, port in reversed(running):
                server.should_exit = True
                await asyncio.wait_for(task, 10)
                sock.close()
    elif args.verify:
        results = [await collect(args.base_url, scenario, count, validators, args.quiet, True)
                   for scenario, count in scenarios]
    else:
        results = [await collect(args.base_url, args.scenario, args.samples, validators, args.quiet)]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    print("Frontend schema checked." if args.frontend_schema else "Only backend schema checked; frontend schema file not supplied.")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--scenario", choices=["calming", "not_responding", "already_sleepy"])
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--verify", action="store_true", help="Reset and verify three scenarios serially")
    parser.add_argument("--local", action="store_true", help="Start isolated servers and verify in parallel")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--frontend-schema", help="Optional frontend JSON Schema for dual validation")
    args = parser.parse_args()
    if args.samples < 1:
        parser.error("--samples must be positive")
    asyncio.run(main(args))
