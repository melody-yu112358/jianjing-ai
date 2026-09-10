"""Offline replay only: never posts HR or ignores API freshness/session checks."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.sensors.ppg import PPGRequest, estimate_ppg


def replay(record):
    if record.get('format') != 'jianjing-ppg-calibration-v1':
        raise ValueError('Unsupported calibration record format')
    request = PPGRequest.model_validate(record['request'])
    return estimate_ppg(request.samples, torch_enabled=request.torch_enabled).model_dump()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('record', type=Path)
    args = parser.parse_args()
    try:
        record = json.loads(args.record.read_text(encoding='utf-8-sig'))
        print(json.dumps(replay(record), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f'Replay failed: {error}\n')


if __name__ == '__main__':
    main()
