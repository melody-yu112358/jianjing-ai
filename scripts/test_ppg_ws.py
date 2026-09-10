"""Synthetic PPG over real HTTP/WebSockets; no physical camera is used."""
import asyncio
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from jsonschema import Draft202012Validator
from websockets.asyncio.client import connect

from backend.main import create_app
from backend.llm.provider import LLMSettings
from backend.sensors.external import SensorSettings
from test_phase3_live import start


def samples(bpm):
    return [{"t":i/30,"r":180+2*math.sin(2*math.pi*bpm/60*i/30),"g":70,"b":50} for i in range(751)]


async def main():
    server, task, sock, port = await start(create_app(LLMSettings(), SensorSettings(mode="mixed", ttl_sec=2)))
    base = f"http://127.0.0.1:{port}"
    frames, arrivals = [], []
    stop = asyncio.Event()
    root = Path(__file__).resolve().parents[1]
    validators = [Draft202012Validator(json.loads((root/'docs'/p).read_text()))
                  for p in ('state.schema.json','agent-control-v2.schema.json')]
    try:
        async with httpx.AsyncClient(trust_env=False, timeout=10) as client:
            status = (await client.get(base+'/api/sensor/status')).json()
            session_id = status['session_id']

            async def receive():
                async with connect(base.replace('http','ws')+'/ws/state', proxy=None) as old, connect(base.replace('http','ws')+'/ws/control', proxy=None) as new:
                    while not stop.is_set():
                        raw1, raw2 = await asyncio.gather(asyncio.wait_for(old.recv(),3),asyncio.wait_for(new.recv(),3))
                        a,b = json.loads(raw1),json.loads(raw2)
                        validators[0].validate(a); validators[1].validate(b)
                        if frames and b['session_id'] == frames[-1]['session_id']:
                            assert b['seq'] > frames[-1]['seq']
                        if b['data_source'] == 'mixed':
                            assert b['payload']['signals']['heart_rate'] in (72,90)
                        frames.append(b); arrivals.append(time.monotonic())

            async def produce():
                # Respect the actual 25-second session window, although pixels are synthetic.
                await asyncio.sleep(25.2)
                for phase,bpm in [('pre',90),('post',72)]:
                    body = dict(timestamp=time.time(),session_id=session_id,phase=phase,torch_enabled=True,samples=samples(bpm))
                    response = await client.post(base+'/api/sensor/ppg',json=body)
                    response.raise_for_status()
                    assert response.json()['valid'] and response.json()['heart_rate'] == bpm
                    assert response.json()['sensor_status']['heart_rate']['source'] == 'phone_ppg'
                    await asyncio.sleep(1.3)
                    status = (await client.get(base+'/api/sensor/status')).json()
                    assert status['last_consumed']['heart_rate'] == bpm
                    assert status['last_consumed']['field_sources']['heart_rate'] == 'phone_ppg'
                    if phase == 'pre':
                        body['timestamp'] = time.time()
                        body['samples'] = [{**s,'r':180} for s in body['samples']]
                        invalid = (await client.post(base+'/api/sensor/ppg',json=body)).json()
                        assert not invalid['valid'] and not invalid['accepted']
                        await asyncio.sleep(24)
                        assert (await client.get(base+'/api/sensor/status')).json()['effective_data_source'] == 'simulated'
                summary = (await client.get(base+'/api/session/summary')).json()
                assert summary['pre_ritual_hr'] == 90 and summary['post_ritual_hr'] == 72
                await asyncio.sleep(2.1)
                assert (await client.get(base+'/api/session/summary')).json()['data_source'] == 'simulated'
                (await client.post(base+'/api/demo',json={'scenario':'calming'})).raise_for_status()
                assert (await client.get(base+'/api/session/summary')).json()['pre_ritual_hr'] is None
                await asyncio.sleep(1.2)
                stop.set()
            await asyncio.gather(receive(), produce())
        assert {'mixed','simulated'} == {f['data_source'] for f in frames}
        assert frames[-1]['session_id'] != session_id
        average = (arrivals[-1]-arrivals[0])/(len(arrivals)-1)
        assert 0.8 < average < 1.3
        print(json.dumps({'frames_per_protocol':len(frames),'mean_interval':round(average,3),
            'pre_hr':90,'post_hr':72,'invalid_rejected':True,'stale_fallback':True,'reset_cleared':True,
            'physical_phone_tested':False},indent=2))
    finally:
        server.should_exit=True
        await asyncio.wait_for(task,10)
        sock.close()


if __name__ == '__main__':
    asyncio.run(main())
