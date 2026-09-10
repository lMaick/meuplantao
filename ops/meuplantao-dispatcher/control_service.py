from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PAUSE_MESSAGE = "Dispatcher pausado para novas tarefas \u2014 execu\u00e7\u00e3o atual n\u00e3o foi interrompida."

AGENT_STATE_CONTRACT = "mai-68/agent-state-v1"
ACTIVE_AGENT_STATES = frozenset({"working"})
WAITING_AGENT_STATES = frozenset({"blocked", "waiting"})
IDLE_AGENT_STATES = frozenset({"done"})
KNOWN_AGENT_STATES = frozenset(set(ACTIVE_AGENT_STATES) | set(WAITING_AGENT_STATES) | set(IDLE_AGENT_STATES))
STRUCTURED_INCOMPLETE = object()
ALLOWED_AGENT_TYPES = frozenset({"codex"})


def normalize_agent_state(value) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    return text or None


def classify_agent_state(value) -> str:
    state = normalize_agent_state(value)
    if state in ACTIVE_AGENT_STATES:
        return "EXECUTANDO"
    if state in WAITING_AGENT_STATES:
        return "AGUARDANDO"
    if state in IDLE_AGENT_STATES:
        return "OCIOSO"
    return "DESCONHECIDO"


def summarize_agent_states(states: list | None) -> dict:
    summary = {"total": 0, "active": 0, "waiting": 0, "idle": 0, "failed": 0, "unknown": 0, "contract": AGENT_STATE_CONTRACT}
    for entry in states or []:
        raw = entry.get("state") if isinstance(entry, dict) else None
        state = normalize_agent_state(raw)
        summary["total"] += 1
        if state in ACTIVE_AGENT_STATES:
            summary["active"] += 1
        elif state in WAITING_AGENT_STATES:
            summary["waiting"] += 1
        elif state in IDLE_AGENT_STATES:
            summary["idle"] += 1
        else:
            summary["unknown"] += 1
    return summary


def _coerce_structured_states(payload) -> list | None:
    if payload is None:
        return None
    if isinstance(payload, dict):
        if "worktrees" in payload:
            worktrees = payload.get("worktrees")
            if not isinstance(worktrees, list):
                return None
            candidates = []
            for worktree in worktrees:
                if not isinstance(worktree, dict):
                    return None
                agents = worktree.get("agents")
                if not isinstance(agents, list):
                    return None
                for agent in agents:
                    if not isinstance(agent, dict):
                        return None
                    candidates.append({"worktree": worktree.get("path") or worktree.get("worktreePath") or "", "pane": agent.get("paneKey", ""), "state": agent.get("state"), "agentType": agent.get("agentType", "")})
        elif isinstance(payload.get("agents"), list):
            candidates = []
            for agent in payload.get("agents"):
                if not isinstance(agent, dict):
                    return None
                candidates.append({"worktree": agent.get("worktree") or agent.get("worktreePath") or agent.get("path") or "", "pane": agent.get("pane") or agent.get("paneKey") or agent.get("handle") or "", "state": agent.get("state"), "agentType": agent.get("agentType") or agent.get("agentIdentity") or ""})
        else:
            return None
    elif isinstance(payload, list):
        candidates = []
        for entry in payload:
            if not isinstance(entry, dict):
                return None
            candidates.append({"worktree": entry.get("worktree") or entry.get("worktreePath") or entry.get("path") or "", "pane": entry.get("pane") or entry.get("paneKey") or entry.get("handle") or "", "state": entry.get("state"), "agentType": entry.get("agentType") or entry.get("agentIdentity") or ""})
    else:
        return None
    for candidate in candidates:
        worktree = candidate.get("worktree")
        pane = candidate.get("pane")
        agent_type = candidate.get("agentType")
        if not isinstance(worktree, str) or not worktree.strip():
            return None
        if not isinstance(pane, str) or not pane.strip():
            return None
        if not isinstance(agent_type, str) or agent_type.strip().lower() not in ALLOWED_AGENT_TYPES:
            return None
        if normalize_agent_state(candidate.get("state")) not in KNOWN_AGENT_STATES:
            return None
    return candidates


def _complete_items(result, items_key, what):
    if not isinstance(result, dict):
        raise RuntimeError(f"{what}: invalid envelope")
    scope = result.get("hostScope")
    if not isinstance(scope, dict):
        raise RuntimeError(f"{what}: missing host scope")
    host_ids = scope.get("hostIds")
    if not isinstance(host_ids, list) or not host_ids:
        raise RuntimeError(f"{what}: unverifiable host scope")
    if scope.get("omittedHostIds") != []:
        raise RuntimeError(f"{what}: partial host scope")
    if result.get("truncated") is not False:
        raise RuntimeError(f"{what}: truncated discovery")
    items = result.get(items_key, [])
    if not isinstance(items, list):
        raise RuntimeError(f"{what}: invalid items")
    total = result.get("totalCount")
    if isinstance(total, bool) or not isinstance(total, int) or total < 0 or total != len(items):
        raise RuntimeError(f"{what}: incoherent total count")
    return items


def _canonical_repo_id() -> str:
    import dispatcher_home
    config = dispatcher_home.load_config_dict()
    repo = str(config.get("repo_name", "meuplantao"))
    worktrees = _complete_items(_orca_run("worktree", "list", "--repo", f"name:{repo}"), "worktrees", "worktree list")
    for wt in worktrees:
        if not isinstance(wt, dict):
            raise RuntimeError('worktree list: invalid worktree identity')
        if not isinstance(wt.get('repo'), str) or not wt.get('repo').strip():
            raise RuntimeError('worktree list: invalid worktree identity')
        if wt.get('repo') != repo:
            raise RuntimeError('worktree list: foreign repo')
        if not isinstance(wt.get('repoId'), str) or not wt.get('repoId').strip():
            raise RuntimeError('worktree list: invalid worktree identity')
        if not isinstance(wt.get('path') or wt.get('worktreePath'), str) or not (wt.get('path') or wt.get('worktreePath')).strip():
            raise RuntimeError('worktree list: invalid worktree identity')
    repo_ids = {wt.get('repoId') for wt in worktrees}
    if len(repo_ids) != 1:
        raise RuntimeError("worktree list: no unique repo id")
    return next(iter(repo_ids))


def _duplicate_writable_panes(agents: list) -> list:
    groups: dict = {}
    for term in agents or []:
        if not isinstance(term, dict):
            continue
        if term.get("orphaned"):
            continue
        identity = str(term.get("agentIdentity") or term.get("agentType") or "")
        if identity and identity != "codex":
            continue
        if term.get("writable") is False:
            continue
        if term.get("connected") is False:
            continue
        path = term.get("worktreePath") or term.get("worktree") or term.get("path") or ""
        groups.setdefault(path, []).append(term.get("handle") or term.get("pane") or term.get("paneKey") or "")
    return [{"worktree": path, "panes": handles} for path, handles in groups.items() if len(handles) > 1]


def _duplicate_warning(duplicates: list) -> str:
    parts = []
    for dup in duplicates:
        parts.append(f"{dup.get('worktree', '')}: {len(dup.get('panes', []))} panes Codex gravaveis")
    detail = "; ".join(parts)
    return f"ATENCAO: multiplos panes Codex gravaveis no mesmo worktree ({detail}); vinculo unico issue->worktree->agente violado; nenhum pane foi fechado automaticamente."

def _real_deps() -> dict:
    return {
        "get_mode": _get_mode_real,
        "set_mode": _set_mode_real,
        "query_scheduler": _query_scheduler_real,
        "check_config": _check_config_real,
        "check_orca": _check_orca_real,
        "list_agents": _list_agents_real,
        "get_agent_states": _get_agent_states_real,
        "read_state": _read_state_real,
        "run_dispatcher": _run_dispatcher_real,
        "read_logs": _read_logs_real,
        "acquire_tick_lock": _acquire_tick_lock_real,
        "release_tick_lock": _release_tick_lock_real,
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
    timeout = d.get("lock_timeout", 120.0)
    handle = d["acquire_tick_lock"](timeout)
    try:
        agents = d["list_agents"]() or []
        raw_states = _safe_agent_states(d)
        if raw_states is STRUCTURED_INCOMPLETE:
            raise RuntimeError("indeterminado (fail-closed): estado estruturado incompleto ou sem escopo verificavel")
        structured = _coerce_structured_states(raw_states)
        d["set_mode"]("PAUSED")
    finally:
        d["release_tick_lock"](handle)
    if structured is not None:
        executing = any(normalize_agent_state(entry.get("state")) in ACTIVE_AGENT_STATES for entry in structured)
    else:
        executing = bool(agents)
    if executing:
        return PAUSE_MESSAGE
    return "Dispatcher pausado para novas tarefas."

def resume(deps: dict | None = None) -> str:
    d = _resolve(deps)
    d["set_mode"]("AUTO")
    return "Dispatcher ativado para novos dispatches."

def build_dispatcher_command() -> list:
    import dispatcher_home
    home = dispatcher_home.home()
    script = dispatcher_home.dispatcher_script()
    if not script.is_file():
        raise RuntimeError(f"dispatcher engine missing outside bundle: {script}")
    wrapper = home / "run-dispatcher.cmd"
    if wrapper.is_file():
        return ["cmd", "/c", str(wrapper), "--manual-once"]
    python = os.environ.get("MEUPLANTAO_DISPATCHER_PYTHON", "").strip().strip(chr(34))
    if python:
        return [os.path.expandvars(python), str(script), "--manual-once"]
    if getattr(sys, "frozen", False):
        raise RuntimeError(
            "frozen bundle has no run-dispatcher.cmd and no MEUPLANTAO_DISPATCHER_PYTHON; "
            "refusing to reuse MaickDispatcherControl.exe as Python interpreter (fail-closed)"
        )
    return [sys.executable, str(script), "--manual-once"]


def run_once(deps: dict | None = None) -> dict:
    d = _resolve(deps)
    try:
        cmd = build_dispatcher_command()
    except Exception as exc:
        return {"ok": False, "skipped": False, "result": f"fail-closed: {exc}"[:500]}
    if getattr(sys, "frozen", False):
        for part in cmd:
            if str(part).lower() == str(sys.executable).lower():
                return {"ok": False, "skipped": False, "result": "fail-closed: frozen exe must never run dispatcher.py"}
    result = d["run_dispatcher"](cmd)
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
        agents_ok = True
        agents_error = ""
    except Exception as exc:
        agents = []
        agents_ok = False
        agents_error = str(exc)[:300]
    raw_states = _safe_agent_states(d)
    if raw_states is STRUCTURED_INCOMPLETE:
        structured = None
        structured_ok = False
        structured_incomplete = True
    else:
        structured = _coerce_structured_states(raw_states)
        structured_ok = structured is not None
        structured_incomplete = False
    duplicates = _duplicate_writable_panes(agents)
    warning = _duplicate_warning(duplicates) if duplicates else ""
    try:
        orca_ok = bool(d["check_orca"]())
    except Exception:
        orca_ok = False
    try:
        runtime_state = d["read_state"]() or {}
    except Exception as exc:
        return {"visual": "ERRO", "mode": mode, "error": str(exc)[:300], "scheduler": sched, "configOk": bool(config_ok), "linearOk": False, "orcaOk": bool(orca_ok), "schedulerOk": False}
    if structured_ok:
        summary = summarize_agent_states(structured)
        executing = summary["active"] > 0
        active_count = summary["active"]
    else:
        executing = bool(agents)
        active_count = len(agents)
        summary = {"total": len(agents), "active": len(agents), "waiting": 0, "idle": 0, "failed": 0, "unknown": 0, "contract": AGENT_STATE_CONTRACT, "fallback": "legacy-connected-panes"}
    if not config_ok or not sched.get("exists") or not sched.get("enabled") or not orca_ok:
        return {"visual": "ERRO", "mode": mode, "scheduler": sched, "configOk": bool(config_ok), "configError": config_error, "linearOk": bool(config_ok), "orcaOk": bool(orca_ok), "schedulerOk": False, "agents": active_count, "structuredOk": structured_ok, "agentStates": summary, "duplicateAgents": duplicates, "warning": warning, "runtime": _sanitized_runtime(runtime_state)}
    if structured_incomplete:
        return {"visual": "ERRO", "mode": mode, "error": "indeterminado (fail-closed): estado estruturado incompleto ou sem escopo verificavel", "scheduler": sched, "configOk": bool(config_ok), "linearOk": False, "orcaOk": bool(orca_ok), "schedulerOk": False, "agents": 0, "structuredOk": False, "agentStates": summary, "duplicateAgents": [], "warning": "", "runtime": _sanitized_runtime(runtime_state)}
    if not structured_ok and not agents_ok:
        return {"visual": "ERRO", "mode": mode, "error": f"indeterminado (fail-closed): descoberta legada falhou e sem estado estruturado: {agents_error}", "scheduler": sched, "configOk": bool(config_ok), "linearOk": False, "orcaOk": bool(orca_ok), "schedulerOk": False, "agents": 0, "structuredOk": False, "agentStates": summary, "duplicateAgents": [], "warning": "", "runtime": _sanitized_runtime(runtime_state)}
    if executing:
        visual = "EXECUTANDO"
    elif mode == "PAUSED":
        visual = "PAUSADO"
    else:
        visual = "ATIVO"
    message = PAUSE_MESSAGE if (mode == "PAUSED" and executing) else ""
    if warning:
        message = f"{message} {warning}".strip() if message else warning
    return {"visual": visual, "mode": mode, "scheduler": sched, "configOk": True, "linearOk": True, "orcaOk": True, "schedulerOk": True, "agents": active_count, "structuredOk": structured_ok, "agentStates": summary, "duplicateAgents": duplicates, "warning": warning, "panes": len(agents), "runtime": _sanitized_runtime(runtime_state), "nextRun": sched.get("nextRun", ""), "message": message}

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
        import dispatcher_home
        dispatcher_home.load_config_dict()
        return (True, "")
    except Exception as exc:
        return (False, str(exc)[:300])

def _orca_cli() -> tuple:
    import dispatcher_home
    import os
    config = dispatcher_home.load_config_dict()
    orca_dir = Path(os.path.expandvars(str(config["orca_dir"]))).expanduser()
    exe = orca_dir / "Orca.exe"
    cli = orca_dir / "resources/app.asar.unpacked/out/cli/index.js"
    return exe, cli, orca_dir

def _orca_run(*args: str, timeout: int = 120, input_text: str | None = None) -> dict:
    import os
    exe, cli, orca_dir = _orca_cli()
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    completed = subprocess.run([str(exe), str(cli), *args, "--json"], cwd=str(orca_dir), input=input_text, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=timeout, env=env)
    output = (completed.stdout or "") + (completed.stderr or "")
    if completed.returncode != 0:
        raise RuntimeError(output[-800:])
    payload = json.loads(completed.stdout)
    if not payload.get("ok"):
        raise RuntimeError(f"Orca error: {json.dumps(payload.get('error'), ensure_ascii=False)[:500]}")
    return payload.get("result", {})

def _check_orca_real() -> bool:
    try:
        status = _orca_run("status")
        return bool(status.get("runtime", {}).get("reachable"))
    except Exception:
        return False

def _safe_agent_states(d: dict):
    fn = d.get("get_agent_states")
    if not callable(fn):
        return None
    try:
        return fn()
    except Exception:
        return None


def _get_agent_states_real() -> list | None:
    import dispatcher_home
    try:
        result = _orca_run("worktree", "ps")
    except Exception:
        return None
    try:
        worktrees = _complete_items(result, "worktrees", "worktree ps")
    except Exception:
        return STRUCTURED_INCOMPLETE
    for wt in worktrees:
        if not isinstance(wt, dict):
            return STRUCTURED_INCOMPLETE
        if not isinstance(wt.get("repo"), str) or not wt.get("repo").strip():
            return STRUCTURED_INCOMPLETE
        if not isinstance(wt.get("repoId"), str) or not wt.get("repoId").strip():
            return STRUCTURED_INCOMPLETE
        if not isinstance(wt.get("path") or wt.get("worktreePath"), str) or not (wt.get("path") or wt.get("worktreePath")).strip():
            return STRUCTURED_INCOMPLETE
        if not isinstance(wt.get("agents"), list):
            return STRUCTURED_INCOMPLETE
    try:
        repo_id = _canonical_repo_id()
    except Exception:
        return STRUCTURED_INCOMPLETE
    scoped = [wt for wt in worktrees if wt.get("repoId") == repo_id]
    return _coerce_structured_states({"worktrees": scoped})


def _list_agents_real() -> list:
    import dispatcher_home
    config = dispatcher_home.load_config_dict()
    repo = str(config.get("repo_name", "meuplantao"))
    agents = []
    worktrees = _complete_items(_orca_run("worktree", "list", "--repo", f"name:{repo}"), "worktrees", "worktree list")
    for wt in worktrees:
        if not isinstance(wt, dict):
            continue
        path = wt.get("path", "")
        if not path:
            continue
        try:
            terminals = _complete_items(_orca_run("terminal", "list", "--worktree", f"path:{path}"), "terminals", "terminal list")
        except Exception as exc:
            raise RuntimeError(f"terminal list failed for worktree {path}: {exc}") from exc
        for term in terminals:
            if not isinstance(term, dict):
                continue
            if term.get("agentIdentity") != "codex" or term.get("orphaned"):
                continue
            term["worktreePath"] = path
            term["worktreeId"] = wt.get("worktreeId", "")
            agents.append(term)
    return agents

def _read_state_real() -> dict:
    import dispatcher_home
    path = dispatcher_home.state_path()
    if not path.exists():
        return {"runtime": {}, "issues": {}}
    return json.loads(path.read_text(encoding="utf-8"))

def _run_dispatcher_real(args: list) -> dict:
    completed = subprocess.run(list(args), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    return {"returncode": completed.returncode, "output": (completed.stdout or "") + (completed.stderr or "")}

def _acquire_tick_lock_real(timeout: float = 120.0):
    import dispatcher_home
    return dispatcher_home.acquire_tick_lock(dispatcher_home.lock_path(), timeout=timeout)


def _release_tick_lock_real(handle) -> None:
    import dispatcher_home
    return dispatcher_home.release_tick_lock(handle)


def _read_logs_real(n: int = 50) -> list:
    import dispatcher_home
    path = dispatcher_home.log_path()
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return lines[-n:]
