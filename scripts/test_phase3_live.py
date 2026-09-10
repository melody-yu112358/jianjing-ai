"""Real TCP/WebSocket tests using a local protocol stub, never an external model."""
import asyncio
import json
from pathlib import Path
import socket
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
import uvicorn
from fastapi import FastAPI, Request
from websockets.asyncio.client import connect

from backend.llm.mock import MockLLMProvider
from backend.llm.provider import LLMSettings
from backend.main import create_app
from backend.models import Frame


async def start(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():
            await task
            raise RuntimeError("Server failed to start")
        await asyncio.sleep(0.01)
    return server, task, sock, port


async def main():
    stub = FastAPI()
    requests = []
    @stub.post("/{kind}/chat/completions")
    async def completion(kind: str, request: Request):
        body = await request.json()
        payload = json.loads(body["messages"][1]["content"])
        assert "signals" not in payload and "heart_rate" not in payload
        assert len(payload["recent_decisions"]) <= 3
        assert body["response_format"]["json_schema"]["strict"]
        requests.append(kind)
        if kind == "slow":
            await asyncio.sleep(2)
        content = await MockLLMProvider().generate_decision(payload)
        return {"choices": [{"message": {"content": content}}]}

    running = []
    try:
        provider_server = await start(stub)
        running.append(provider_server)
        base = f"http://127.0.0.1:{provider_server[3]}"
        configurations = {
            "rule": LLMSettings(mode="rule"),
            "mock_llm": LLMSettings(mode="mock_llm"),
            "llm_local_protocol": LLMSettings(mode="llm", base_url=base + "/ok", api_key="local-test-only", model="protocol-stub"),
            "llm_timeout": LLMSettings(mode="llm", base_url=base + "/slow", api_key="local-test-only", model="protocol-stub", timeout_sec=1),
            "llm_unconfigured": LLMSettings(mode="llm"),
        }
        for settings in configurations.values():
            running.append(await start(create_app(settings)))

        async def check(name, port):
            endpoint = f"http://127.0.0.1:{port}"
            frames, arrivals = [], []
            async with httpx.AsyncClient(trust_env=False) as client:
                (await client.post(endpoint + "/api/demo", json={"scenario": "not_responding"})).raise_for_status()
                async with connect(f"ws://127.0.0.1:{port}/ws/state", proxy=None) as ws:
                    for _ in range(45):
                        frames.append(Frame.model_validate_json(await asyncio.wait_for(ws.recv(), 3)))
                        arrivals.append(time.monotonic())
                    status = (await client.get(endpoint + "/api/controller")).json()
                    assert frames[-1].ritual.stage == "switch_method"
                    if name in ("mock_llm", "llm_local_protocol"):
                        assert status["successes"] >= 2 and status["failures"] == 0
                    elif name != "rule":
                        assert status["failures"] >= 2 and status["source"] == "fallback"
                    else:
                        assert status["calls"] == 0
                    before = time.monotonic()
                    stop = await client.post(endpoint + "/api/feedback", json={"event": "discomfort"})
                    assert time.monotonic() - before < 1
                    assert stop.json()["ritual"]["action"] == "end"
                    stopped = Frame.model_validate_json(await asyncio.wait_for(ws.recv(), 2))
                    assert stopped.state.state_class == "discomfort" and stopped.visual.intensity == 0
            average = (arrivals[-1] - arrivals[0]) / 44
            assert 0.8 < average < 1.3
            assert all(b.timestamp > a.timestamp for a, b in zip(frames, frames[1:]))
            return {"case": name, "frames": 45, "mean_interval": round(average, 3),
                    "controller": status, "discomfort": "passed"}
        results = await asyncio.gather(*(check(name, server[3]) for name, server in zip(configurations, running[1:])))
        assert "ok" in requests and "slow" in requests
        print(json.dumps(results, indent=2))
        print("External vendor/model was NOT called; llm adapter used local HTTP protocol stub.")
    finally:
        for server, task, sock, port in reversed(running):
            server.should_exit = True
            await asyncio.wait_for(task, 10)
            sock.close()


if __name__ == "__main__":
    asyncio.run(main())
