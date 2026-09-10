"""Start both ends inside the same network namespace, then clean up."""
import subprocess
import time
import select
from pathlib import Path
root=Path(__file__).resolve().parents[1]
server=subprocess.Popen(['python', 'examples/agent_mock.py', '--interval', '0.1', '--mode-seconds', '0.2'],cwd=root,stdout=subprocess.PIPE,text=True)
try:
    ready,_,_=select.select([server.stdout],[],[],3)
    if not ready or not server.stdout.readline().startswith('Synthetic Agent:'):
        raise RuntimeError('Mock Agent did not become ready')
    subprocess.run(['node','--experimental-strip-types','tests/ws-smoke.mjs'],cwd=root,check=True,timeout=8)
finally:
    server.terminate()
    server.wait(timeout=3)
