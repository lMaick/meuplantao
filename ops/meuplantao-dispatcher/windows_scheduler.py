from __future__ import annotations

import subprocess
from pathlib import Path

TASK_NAME = "MeuPlantaoDispatcher"

def _default_runner(*args: str, **kwargs: str) -> str:
    completed = subprocess.run(list(args), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    output = (completed.stdout or "") + (completed.stderr or "")
    if completed.returncode != 0:
        raise RuntimeError(output[-1000:] or f"schtasks failed ({completed.returncode})")
    return output

def query_scheduler(runner=None, task_name: str = TASK_NAME) -> dict:
    run = runner or _default_runner
    try:
        output = run("schtasks", "/Query", "/TN", task_name, "/V", "/FO", "LIST")
    except Exception as exc:
        return {"exists": False, "enabled": False, "status": "Error", "error": str(exc)[:500]}
    text = str(output)
    if "ERROR:" in text.upper():
        return {"exists": False, "enabled": False, "status": "Missing", "error": text[-500:]}
    enabled = ("Enabled: Yes" in text) or ("Status: Ready" in text and "Disabled" not in text)
    if "Disabled" in text and "Enabled: Yes" not in text:
        enabled = False
    status = "Ready" if enabled else ("Disabled" if "Disabled" in text else "Unknown")
    last_run = ""
    next_run = ""
    for line in text.splitlines():
        low = line.strip().lower()
        if low.startswith("last run time:"):
            last_run = line.split(":", 1)[1].strip()
        elif low.startswith("next run time:"):
            next_run = line.split(":", 1)[1].strip()
    return {"exists": True, "enabled": bool(enabled), "status": status, "lastRun": last_run, "nextRun": next_run}
