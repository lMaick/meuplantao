from __future__ import annotations

import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

TASK_NAME = "Hermes-MeuPlantao-Dispatcher"
TASK_NS = "http://schemas.microsoft.com/windows/2004/02/mit/task"
_DATETIME_RE = re.compile(r"\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]\.?M\.?)?", re.IGNORECASE)
_NOT_FOUND_RE = re.compile(r"cannot find|not found|n.o .*encontr|n.o existe|especificad", re.IGNORECASE)

def resolve_task_name(task_name: str | None = None) -> str:
    if task_name:
        return task_name
    try:
        import dispatcher
        name = str(getattr(dispatcher, "SCHEDULER_TASK_NAME", "") or "")
        if name:
            return name
    except Exception:
        pass
    return TASK_NAME

def _default_runner(*args: str, **kwargs: str) -> str:
    completed = subprocess.run(list(args), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    output = (completed.stdout or "") + (completed.stderr or "")
    if completed.returncode != 0:
        raise RuntimeError(output[-1000:] or f"schtasks failed ({completed.returncode})")
    return output

def _parse_task_xml(text: str) -> dict:
    clean = re.sub(r"<\?xml[^?]*\?>", "", str(text), count=1).strip()
    root = ET.fromstring(clean)
    ns = {"t": TASK_NS}
    def find(path: str) -> str:
        node = root.find(path, ns)
        return (node.text or "").strip() if node is not None and node.text else ""
    enabled_text = find(".//t:Settings/t:Enabled") or find(".//{http://schemas.microsoft.com/windows/2004/02/mit/task}Settings/{http://schemas.microsoft.com/windows/2004/02/mit/task}Enabled")
    enabled = enabled_text.lower() == "true"
    interval = find(".//t:Repetition/t:Interval")
    time_limit = find(".//t:Settings/t:ExecutionTimeLimit")
    return {"enabled": enabled, "interval": interval, "timeLimit": time_limit}

def _extract_run_times(list_output: str) -> tuple:
    last_run, next_run = "", ""
    for line in str(list_output).splitlines():
        match = _DATETIME_RE.search(line)
        if not match:
            continue
        label = line.split(":", 1)[0]
        if re.search(r"next|pr.xim", label, re.IGNORECASE):
            next_run = match.group(0).strip()
        elif re.search(r"last|.ltim", label, re.IGNORECASE):
            last_run = match.group(0).strip()
    return last_run, next_run

def query_scheduler(runner=None, task_name: str | None = None) -> dict:
    name = resolve_task_name(task_name)
    run = runner or _default_runner
    try:
        xml_text = run("schtasks", "/Query", "/TN", name, "/XML")
    except Exception as exc:
        message = str(exc)[:500]
        status = "Missing" if _NOT_FOUND_RE.search(message) or "ERROR:" in message.upper() else "Error"
        return {"exists": False, "enabled": False, "status": status, "taskName": name, "error": message}
    if "ERROR:" in str(xml_text).upper():
        return {"exists": False, "enabled": False, "status": "Missing", "taskName": name, "error": str(xml_text)[-500:]}
    try:
        parsed = _parse_task_xml(str(xml_text))
    except Exception as exc:
        return {"exists": False, "enabled": False, "status": "Error", "taskName": name, "error": f"task XML parse failed: {exc}"[:500]}
    try:
        list_text = run("schtasks", "/Query", "/TN", name, "/V", "/FO", "LIST")
        last_run, next_run = _extract_run_times(list_text)
    except Exception:
        last_run, next_run = "", ""
    enabled = bool(parsed["enabled"])
    return {
        "exists": True,
        "enabled": enabled,
        "status": "Ready" if enabled else "Disabled",
        "taskName": name,
        "lastRun": last_run,
        "nextRun": next_run,
        "interval": parsed["interval"],
        "timeLimit": parsed["timeLimit"],
    }
