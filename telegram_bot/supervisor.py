"""Independent watchdog: recover even if the bot's event loop freezes."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

stopping = False
child = None


def stop(_signum, _frame):
    global stopping
    stopping = True
    if child and child.poll() is None:
        child.terminate()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
(Path(os.environ.get('BOT_STATE_DIR', '/app/state')) / 'heartbeat.json').unlink(missing_ok=True)
child = subprocess.Popen([sys.executable, 'app.py'])
started = time.time()
result = 1
try:
    while not stopping and child.poll() is None:
        if time.time() - started > 90:
            try:
                heartbeat = json.loads((Path(os.environ.get('BOT_STATE_DIR', '/app/state')) / 'heartbeat.json').read_text())
                if any(time.time() - heartbeat[key] > 180 for key in ['time', 'sync', 'poll']):
                    raise RuntimeError()
            except Exception:
                print('{"event":"supervisor_restart","reason":"stale_heartbeat"}', flush=True)
                break
        time.sleep(5)
    if stopping:
        result = 0
finally:
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
raise SystemExit(result)
