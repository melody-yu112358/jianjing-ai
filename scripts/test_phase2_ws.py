"""Real-time serial demo verification; resets the shared server session."""
import argparse
import asyncio
import json

import httpx
from websockets.asyncio.client import connect

from test_ws import collect, Frame


async def verify(base):
    results = {}
    for scenario, samples in [("calming", 120), ("not_responding", 45), ("already_sleepy", 55)]:
        frames = await collect(base, scenario, None, samples)
        classes = {f.state.state_class for f in frames}
        stages = {f.ritual.stage for f in frames}
        if scenario == "not_responding":
            assert "not_responding" in classes and "switch_method" in stages
        else:
            assert "ready_to_disengage" in classes and "fade_out" in stages and "end" in stages
        if scenario == "already_sleepy":
            assert "guided_breathing" not in stages
        results[scenario] = {"frames": samples, "classes": sorted(classes), "stages": sorted(stages),
                             "arousal_start": frames[0].state.arousal, "arousal_end": frames[-1].state.arousal}
    async with httpx.AsyncClient(trust_env=False) as client:
        (await client.post(base + "/api/demo", json={"scenario": "calming"})).raise_for_status()
        uri = base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/ws/state"
        async with connect(uri, proxy=None) as ws:
            await ws.recv()
            response = await client.post(base + "/api/feedback", json={"event": "discomfort"})
            response.raise_for_status()
            assert response.json()["ritual"]["action"] == "end"
            # Ignore any already buffered pre-feedback frame.
            for _ in range(3):
                frame = Frame.model_validate_json(await asyncio.wait_for(ws.recv(), 3))
                if frame.state.state_class == "discomfort":
                    break
            assert frame.state.state_class == "discomfort" and frame.ritual.stage == "end"
            assert frame.ritual.audio_intensity == frame.visual.intensity == 0
    print(json.dumps({"scenarios": results, "discomfort_rest_and_ws": "passed"}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    asyncio.run(verify(parser.parse_args().base_url))
