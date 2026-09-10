"""Non-injecting venue check. Opening /ws/control starts/advances the shared ritual."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

import httpx
from websockets.asyncio.client import connect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.control.models import ControlFrame


async def check(base, samples=3):
    base = base.rstrip('/')
    if not base.startswith(('http://', 'https://')):
        raise ValueError('Use an http(s) server URL')
    if samples < 2:
        raise ValueError('At least two snapshots are required')
    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
        health = await client.get(base + '/health'); health.raise_for_status()
        if health.json().get('status') != 'ok':
            raise ValueError('Health check failed')
        page = await client.get(base + '/tools/ppg-demo/'); page.raise_for_status()
        if 'id="diagnostics"' not in page.text:
            raise ValueError('Device diagnostic page missing')
        script = await client.get(base + '/tools/ppg-demo/app.js'); script.raise_for_status()
        status = await client.get(base + '/api/sensor/status'); status.raise_for_status()
        before = status.json()
        url = base.replace('https://', 'wss://', 1).replace('http://', 'ws://', 1) + '/ws/control'
        frames = []
        async with connect(url, proxy=None, open_timeout=5) as ws:
            for _ in range(samples):
                frame = ControlFrame.model_validate_json(await asyncio.wait_for(ws.recv(), 5))
                if frame.session_id != before['session_id']:
                    raise ValueError('Session changed during acceptance; retry in a quiet session')
                if frames and frame.seq <= frames[-1].seq:
                    raise ValueError('Sequence is not increasing')
                if frame.data_source not in ('mixed', 'simulated'):
                    raise ValueError('Unexpected source for current simulated respiration')
                frames.append(frame)
        response = await client.get(base + '/api/sensor/status'); response.raise_for_status()
        after = response.json()
        if after['session_id'] != before['session_id']:
            raise ValueError('Session changed during acceptance')
        return {'health': 'ok', 'ppg_page': 'ok', 'websocket_v2': 'ok', 'frames': len(frames),
                'session_id': before['session_id'], 'frame_sources': [f.data_source for f in frames],
                'current_data_source': after['effective_data_source'], 'ttl_sec': after['ttl_sec'],
                'external_status': after['external_heart_rate'], 'physical_phone_validated': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8000')
    parser.add_argument('--samples', type=int, default=3)
    args = parser.parse_args()
    try:
        print(json.dumps(asyncio.run(check(args.base, args.samples)), ensure_ascii=False, indent=2))
    except Exception as error:
        print(f'Acceptance check failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
