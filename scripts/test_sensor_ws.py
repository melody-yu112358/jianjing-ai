"""Real HTTP + both WebSocket tests with synthetic external HR, no devices."""
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

from backend.llm.provider import LLMSettings
from backend.main import create_app
from backend.sensors.external import SensorSettings
from test_phase3_live import start

ROOT = Path(__file__).resolve().parents[1]


async def verify(base, mode):
    validators = [Draft202012Validator(json.loads((ROOT / "docs" / name).read_text()))
                  for name in ("state.schema.json", "agent-control-v2.schema.json")]
    expected = "mixed" if mode == "mixed" else "simulated"
    packets, times = [], []
    async with httpx.AsyncClient(trust_env=False) as client:
        (await client.post(base + "/api/demo", json={"scenario": "not_responding"})).raise_for_status()
        initial = (await client.get(base + "/api/sensor/status")).json()
        assert initial["mode"] == mode and initial["effective_data_source"] == "simulated"
        wsbase = base.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        async with connect(wsbase + "/ws/state", proxy=None) as v1, connect(wsbase + "/ws/control", proxy=None) as v2:
            async def receive():
                raw1, raw2 = await asyncio.gather(asyncio.wait_for(v1.recv(), 3), asyncio.wait_for(v2.recv(), 3))
                old, new = json.loads(raw1), json.loads(raw2)
                validators[0].validate(old)
                validators[1].validate(new)
                assert abs(time.time() - new["timestamp"]) < 3
                if packets and new["session_id"] == packets[-1]["session_id"]:
                    assert new["seq"] > packets[-1]["seq"]
                packets.append(new)
                times.append(time.monotonic())
                return old, new

            async def post(value):
                body = {"timestamp": time.time(), "heart_rate": value,
                        "session_id": initial["session_id"]}
                result = await client.post(base + "/api/sensor/heart-rate", json=body)
                result.raise_for_status()
                assert result.json()["effective_data_source"] == expected
                return body

            for _ in range(2):
                _, frame = await receive()
                assert frame["data_source"] == "simulated"
            for value, count in ((105, 10), (85, 4)):
                for index in range(count):
                    last_body = await post(value)
                    old, frame = await receive()
                    if index > 0:
                        assert frame["data_source"] == expected
                        if mode == "mixed":
                            assert frame["payload"]["signals"]["heart_rate"] == old["signals"]["heart_rate"] == value
                status = (await client.get(base + "/api/sensor/status")).json()
                assert status["last_consumed"]["field_sources"]["heart_rate"] == ("external" if mode == "mixed" else "simulated")
                if mode == "mixed":
                    assert status["last_consumed"]["heart_rate"] == value
            # TTL is 2 seconds in local mode; external mode script requires <=2.
            for _ in range(4):
                old, fallback = await receive()
            assert fallback["data_source"] == "simulated"
            status = (await client.get(base + "/api/sensor/status")).json()
            assert not status["external_heart_rate"]["fresh"]
            assert status["heart_rate"]["source"] == "simulated"
            if mode == "mixed":
                assert status["stale_reason"] == "external_expired"
            for timestamp in (time.time() - 60, time.time() + 10):
                invalid = await client.post(base + "/api/sensor/heart-rate", json={"timestamp": timestamp, "heart_rate": 100})
                assert invalid.status_code in (409, 422)
            invalid = await client.post(base + "/api/sensor/heart-rate",
                content='{"timestamp":1000,"heart_rate":NaN}', headers={"Content-Type": "application/json"})
            assert invalid.status_code == 422
            for _ in range(2):
                await post(95)
                _, recovered = await receive()
            assert recovered["data_source"] == expected
            previous_id = recovered["session_id"]
            (await client.post(base + "/api/demo", json={"scenario": "already_sleepy"})).raise_for_status()
            replay = await client.post(base + "/api/sensor/heart-rate", json=last_body)
            assert replay.status_code == 409
            for _ in range(3):
                _, reset = await receive()
                if reset["session_id"] != previous_id:
                    break
            assert reset["session_id"] != previous_id and reset["seq"] == 0 and reset["data_source"] == "simulated"
            reset_status = (await client.get(base + "/api/sensor/status")).json()
            assert reset_status["external_heart_rate"]["heart_rate"] is None
    average = (times[-1] - times[0]) / (len(times) - 1)
    assert 0.8 < average < 1.3
    return {"mode": mode, "frames_per_protocol": len(packets), "mean_interval": round(average, 3),
            "sources_seen": sorted({p["data_source"] for p in packets}),
            "hr_update_expiry_recovery_reset": "passed"}


async def main(args):
    if not args.local:
        results = [await verify(args.base_url, args.mode)]
    else:
        running = []
        try:
            for mode in ("simulated", "mixed"):
                running.append(await start(create_app(LLMSettings(), SensorSettings(mode=mode, ttl_sec=2))))
            results = await asyncio.gather(*(verify(f"http://127.0.0.1:{server[3]}", mode)
                for mode, server in zip(("simulated", "mixed"), running)))
        finally:
            for server, task, sock, port in reversed(running):
                server.should_exit = True
                await asyncio.wait_for(task, 10)
                sock.close()
    print(json.dumps(results, indent=2))
    print("External HR values were synthetic HTTP inputs; no real device was used.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local", action="store_true", help="Start isolated test servers, TTL=2 seconds")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--mode", choices=["simulated", "mixed"], default="mixed")
    asyncio.run(main(parser.parse_args()))
