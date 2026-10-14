import json
import os
import sqlite3
import time
from pathlib import Path

try:
    root = Path(os.environ.get('BOT_STATE_DIR', '/app/state'))
    data = json.loads((root / 'heartbeat.json').read_text())
    assert all(time.time() - data[key] < 150 for key in ['time', 'sync', 'poll'])
    with sqlite3.connect(f"file:{root / 'delivery.sqlite'}?mode=ro", uri=True, timeout=3) as db:
        assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
except Exception:
    raise SystemExit(1)
