"""Independent synthetic Agent control source. No sensor, no LLM, no diagnosis.
Run: python examples/agent_mock.py --port 8765
Dependency: websockets (already required by jianjing-ai backend).
Local frontend URL: ws://127.0.0.1:8765/ws/control
"""
import argparse
import asyncio
import json
import math
import time
import uuid
from websockets.asyncio.server import serve

MODES = [
    ('storm', '先不急着改变什么，感受此刻的呼吸。', .95, .94, .90, 24),
    ('fold', '让紧绷一点点松开。', .70, .50, .38, 253),
    ('ripple', '试着让呼气稍微长一点。', .52, .24, .32, 193),
    ('pulse', '跟随轻柔的节奏，不用刻意用力。', .50, .10, .20, 285),
    ('serenity', '按自己的节奏，自然呼吸。', .25, .06, .09, 172),
]

def control_message(session_id, seq, elapsed, mode_seconds):
    mode, text, intensity, noise, speed, hue = MODES[int(elapsed / mode_seconds) % len(MODES)]
    return {
        'type': 'agent.control', 'version': '2.0',
        'session_id': session_id, 'seq': seq, 'timestamp': time.time(),
        'data_source': 'simulated',
        'payload': {
            'visual': {
                'mode': mode, 'intensity': intensity, 'noise': noise, 'speed': speed,
                'deformation': intensity, 'frequency': .2 + noise * .6,
                'turbulence': noise, 'particle_density': .15 + intensity * .75,
                'particle_spread': noise, 'line_density': .15 + intensity * .65,
                'line_activity': speed, 'pulse': .9 if mode == 'pulse' else .3,
                'glow': .4 + intensity * .3, 'hue': hue, 'transition_sec': 2.5,
            },
            'guidance': {
                'text': text, 'stage': 'settling' if mode == 'serenity' else 'guided_breathing',
                'inhale_sec': 0 if mode == 'serenity' else 4,
                'exhale_sec': 0 if mode == 'serenity' else 6,
            },
        },
    }

async def main(args):
    async def handler(socket):
        session_id = str(uuid.uuid4())
        start = time.monotonic()
        seq = 0
        try:
            while True:
                message = control_message(session_id, seq, time.monotonic() - start, args.mode_seconds)
                await socket.send(json.dumps(message, ensure_ascii=False))
                seq += 1
                await asyncio.sleep(args.interval)
        except Exception as exc:
            from websockets.exceptions import ConnectionClosed
            if not isinstance(exc, ConnectionClosed):
                raise
    async with serve(handler, '127.0.0.1', args.port, max_size=65536):
        print(f'Synthetic Agent: ws://127.0.0.1:{args.port}/ws/control', flush=True)
        await asyncio.Future()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--interval', type=float, default=1)
    parser.add_argument('--mode-seconds', type=float, default=12)
    args = parser.parse_args()
    if args.interval <= 0 or args.mode_seconds <= 0:
        parser.error('interval and mode-seconds must be positive')
    asyncio.run(main(args))
