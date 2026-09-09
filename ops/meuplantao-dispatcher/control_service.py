from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAUSE_MESSAGE = "Dispatcher pausado para novas tarefas \u2014 execu\u00e7\u00e3o atual n\u00e3o foi interrompida."

def _real_deps() -> dict:
    return {
        "get_mode": _get_mode_real,
        "set_mode": _set_mode_real,
        "query_scheduler": _query_scheduler_real,
        "check_config": _check_config_real,
        "check_orca": _check_orca_real,
        "list_agents": _list_agents_real,
        "read_state": _read_state_real,
        "run_dispatcher": _run_dispatcher_real,
        "read_logs": _read_logs_real,
    }

def _resolve(deps: dict | None) -> dict:
    real = _real_deps()
    if not deps:
        return real
    merged = dict(real)
    merged.update(deps)
    return merged

def pause(deps: dict | None = None) -> str:
    d = _resolve(deps)
    agents = d["list_agents"]() or []
    d["set_mode"]("PAUSED")
    if agents:
        return PAUSE_MESSAGE
    return "Dispatcher pausado para novas tarefas."

def resume(deps: dict | None = None) -> str:
    d = _resolve(deps)
    d["set_mode"]("AUTO")
    return "Dispatcher ativado para novos dispatches."

def run_once(deps: dict | None = None) -> dict:
    d = _resolve(deps)
    result = d["run_dispatcher"]([sys.executable, str(ROOT / "dispatcher.py"), "--manual-once"])
    output = str(result.get("output", ""))
    if "owns the lock" in output or "lock" in output.lower() and result.get("returncode", 0) == 0 and "skipping" in output.lower():
        return {"ok": True, "skipped": True, "result": "safe skip: lock ativo, nenhum efeito nem duplicata"}
    if result.get("returncode", 0) != 0:
        return {"ok": False, "skipped": False, "result": output[-500:]}
    return {"ok": True, "skipped": False, "result": output[-500:] or "manual iteration complete"}

def last_logs(deps: dict | None = None, n: int = 50) -> list:
    d = _resolve(deps)
    try:
        lines = d["read_logs"](n=n)
    except TypeError:
        lines = d["read_logs"](n)
    return list(lines)[-n:]

def get_status(deps: dict | None = None) -> dict:
    d = _resolve(deps)
    try:
        mode = d["get_mode"]()
    except Exception as exc:
        return {"visual": "ERRO", "mode": "UNKNOWN", "error": str(exc)[:300], "scheduler": {}, "configOk": False, "linearOk": False, "orcaOk": False, "schedulerOk": False}
    config_ok, config_error = d["check_config"]()
    try:
        sched = d["query_scheduler"]() or {}
    except Exception as exc:
        sched = {"exists": False, "enabled": False, "status": "Error", "error": str(exc)[:300]}
    try:
        agents = d["list_agents"]() or []
    except Exception:
        agents = []
    try:
        orca_ok = bool(d["check_orca"]())
    except Exception:
        orca_ok = False
    try:
        runtime_state = d["read_state"]() or {}
    except Exception as exc:
        return {"visual": "ERRO", "mode": mode, "error": str(exc)[:300], "scheduler": sched, "configOk": bool(config_ok), "linearOk": False, "orcaOk": bool(orca_ok), "schedulerOk": False}
    if not config_ok or not sched.get("exists") or not sched.get("enabled"):
        return {"visual": "ERRO", "mode": mode, "scheduler": sched, "configOk": bool(config_ok), "configError": config_error, "linearOk": bool(config_ok), "orcaOk": bool(orca_ok), "schedulerOk": False, "agents": len(agents), "runtime": _sanitized_runtime(runtime_state)}
    if agents:
        visual = "EXECUTANDO"
    elif mode == "PAUSED":
        visual = "PAUSADO"
    else:
        visual = "ATIVO"
    return {"visual": visual, "mode": mode, "scheduler": sched, "configOk": True, "linearOk": True, "orcaOk": bool(orca_ok), "schedulerOk": True, "agents": len(agents), "runtime": _sanitized_runtime(runtime_state), "nextRun": sched.get("nextRun", ""), "message": PAUSE_MESSAGE if (mode == "PAUSED" and agents) else ""}

def _sanitized_runtime(state: dict) -> dict:
    rt = dict((state or {}).get("runtime", {}) or {})
    return {"lastCheck": rt.get("lastCheck"), "lastResult": rt.get("lastResult"), "mode": rt.get("mode"), "dispatched": rt.get("dispatched"), "currentIssue": rt.get("currentIssue")}

def _get_mode_real() -> str:
    import control_state
    return control_state.get_mode()

def _set_mode_real(mode: str) -> str:
    import control_state
    return control_state.set_mode(mode)

def _query_scheduler_real() -> dict:
    import windows_scheduler
    return windows_scheduler.query_scheduler()

def _check_config_real() -> tuple:
    try:
        import dispatcher
        dispatcher.load_config()
        return (True, "")
    except Exception as exc:
        return (False, str(exc)[:300])

def _check_orca_real() -> bool:
    try:
        import dispatcher
        status = dispatcher.orca("status")
        return bool(status.get("runtime", {}).get("reachable"))
    except Exception:
        return False

def _list_agents_real() -> list:
    try:
        import dispatcher
        agents = []
        for wt in dispatcher.list_worktrees():
            try:
                agents.extend(dispatcher.codex_terminals(str(wt.get("path", ""))))
            except Exception:
                continue
        return agents
    except Exception:
        return []

def _read_state_real() -> dict:
    import json
    path = ROOT / "state.json"
    if not path.exists():
        return {"runtime": {}, "issues": {}}
    return json.loads(path.read_text(encoding="utf-8"))

def _run_dispatcher_real(args: list) -> dict:
    completed = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    return {"returncode": completed.returncode, "output": (completed.stdout or "") + (completed.stderr or "")}

def _read_logs_real(n: int = 50) -> list:
    path = ROOT / "dispatcher.log"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return lines[-n:]
