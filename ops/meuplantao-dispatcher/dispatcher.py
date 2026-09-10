from __future__ import annotations

import argparse
import json
import logging
from logging.handlers import RotatingFileHandler
import msvcrt
import os
from pathlib import Path
import re
import subprocess
import shutil
import sys
import time
import tomllib
import unicodedata
import uuid

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.environ.get("MEUPLANTAO_DISPATCHER_CONFIG", ROOT / "config.toml"))
def load_config(path: Path | None = None) -> dict:
    config_path = path or CONFIG_PATH
    if not config_path.exists():
        raise RuntimeError(f"missing dispatcher config: {config_path}; copy config.example.toml to config.toml")
    config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    required = ("orca_dir", "repo_name", "repo_path", "worktree_root", "linear_workspace_id", "team", "project", "gh_executable", "github_repo")
    missing = [key for key in required if key not in config or config[key] is None or (key != "gh_executable" and not config[key])]
    if missing:
        raise RuntimeError("missing dispatcher config keys: " + ", ".join(missing))
    if any("<" in str(config[key]) or ">" in str(config[key]) for key in required):
        raise RuntimeError("dispatcher config contains unresolved placeholders")
    if any("S-1-5-" in str(config[key]) for key in required):
        raise RuntimeError("machine-specific SID hardcode is forbidden; use config")
    return config
CONFIG = load_config()
STATE_PATH = ROOT / "state.json"
LOCK_PATH = ROOT / "dispatcher.lock"
LOG_PATH = ROOT / "dispatcher.log"
ORCA_DIR = Path(os.path.expandvars(CONFIG["orca_dir"])).expanduser()
ORCA_EXE = ORCA_DIR / "Orca.exe"
ORCA_CLI = ORCA_DIR / "resources/app.asar.unpacked/out/cli/index.js"
GH_EXECUTABLE = CONFIG.get("gh_executable") or shutil.which("gh") or "gh"
GITHUB_REPO = CONFIG["github_repo"]
REPO_NAME = CONFIG["repo_name"]
REPO_PATH = Path(os.path.expandvars(CONFIG["repo_path"])).expanduser()
WORKTREE_ROOT = Path(os.path.expandvars(CONFIG["worktree_root"])).expanduser()
LINEAR_WORKSPACE_ID = str(CONFIG["linear_workspace_id"])
TEAM = CONFIG["team"]
PROJECT = CONFIG["project"]
READY_LABEL = CONFIG.get("ready_label", "Orca Ready")
REVIEW_LABEL = CONFIG.get("review_label", "Needs Review")
MODEL = "gpt-5.6-luna"
REASONING = "low"
WORKER_POLICY_KEY = "allowed_workers"
CODEX_REL_CONFIG = Path(".codex/config.toml")
CODEX_REL_AUTH = Path(".codex/auth.json")
OPENCODE_REL_CONFIGS = (Path(".config/opencode/opencode.json"), Path(".opencode.json"), Path(".config/opencode.json"))
OPENCODE_REL_AUTHS = (Path(".config/opencode/auth.json"), Path(".local/share/opencode/auth.json"))
DEFAULT_FORBIDDEN_ROUTING = ("model_provider", "openrouter")


def _pick(mapping: dict, *names: str) -> str:
    lowered = {str(k).lower(): v for k, v in mapping.items()} if isinstance(mapping, dict) else {}
    for name in names:
        key = name.lower()
        if key in lowered and lowered[key] not in (None, ""):
            value = lowered[key]
            return value if isinstance(value, str) else str(value)
    return ""


def allowed_workers(config: dict | None = None) -> list[dict]:
    source = config if config is not None else CONFIG
    if WORKER_POLICY_KEY not in source:
        raise RuntimeError("preflight: worker policy missing (add [[allowed_workers]] to dispatcher config)")
    entries = source.get(WORKER_POLICY_KEY)
    if not isinstance(entries, list) or len(entries) == 0:
        raise RuntimeError("preflight: worker policy empty (configure at least one [[allowed_workers]] entry)")
    normalized: list[dict] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise RuntimeError(f"preflight: worker policy entry {index} malformed")
        model = str(entry.get("model", "") or "").strip()
        reasoning = str(entry.get("reasoning", "") or "").strip()
        agent = str(entry.get("agent", "") or "").strip().lower()
        if not model or not reasoning or not agent:
            raise RuntimeError(f"preflight: worker policy entry {index} missing model/reasoning/agent")
        provider = str(entry.get("provider", "") or "").strip()
        auth_mode = str(entry.get("auth_mode", "") or "").strip()
        forbid = entry.get("forbid_substrings", None)
        if forbid is None:
            forbid = list(DEFAULT_FORBIDDEN_ROUTING) if agent == "codex" else []
        forbid_tuple = tuple(str(item).lower() for item in forbid) if isinstance(forbid, (list, tuple)) else ()
        normalized.append({
            "id": str(entry.get("id", f"worker-{index}") or f"worker-{index}"),
            "agent": agent,
            "model": model,
            "reasoning": reasoning,
            "provider": provider,
            "auth_mode": auth_mode,
            "forbid_substrings": forbid_tuple,
        })
    return normalized


def effective_workers() -> list[dict]:
    try:
        return allowed_workers()
    except RuntimeError:
        return [{
            "id": "legacy-codex",
            "agent": "codex",
            "model": MODEL,
            "reasoning": REASONING,
            "provider": "",
            "auth_mode": "chatgpt",
            "forbid_substrings": tuple(DEFAULT_FORBIDDEN_ROUTING),
        }]


def effective_worker_labels() -> list[str]:
    return [f"{w['agent']} {w['model']} {w['reasoning']}".strip() for w in effective_workers()]


def _read_toml_or_json(path: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        if path.suffix.lower() == ".json":
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else None
        parsed = tomllib.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return {"__unparseable__": True, "__text__": text.lower()}


def read_codex_state(home: Path | None = None) -> dict | None:
    base = home or Path.home()
    config_path = base / CODEX_REL_CONFIG
    auth_path = base / CODEX_REL_AUTH
    config = _read_toml_or_json(config_path)
    if config is None:
        return None
    if config.get("__unparseable__"):
        return {"present": True, "unparseable": True, "config_text": str(config.get("__text__", "")), "model": "", "reasoning": "", "auth_mode": "", "auth_present": False}
    try:
        config_text = config_path.read_text(encoding="utf-8").lower()
    except OSError:
        config_text = ""
    auth = _read_toml_or_json(auth_path)
    auth_mode = _pick(auth, "auth_mode", "mode") if isinstance(auth, dict) else ""
    return {
        "present": True,
        "model": _pick(config, "model"),
        "reasoning": _pick(config, "model_reasoning_effort", "reasoning", "reasoning_effort"),
        "auth_mode": auth_mode,
        "auth_present": auth is not None,
        "config_text": config_text,
    }


def read_opencode_state(home: Path | None = None) -> dict | None:
    base = home or Path.home()
    config_data: dict | None = None
    for rel in OPENCODE_REL_CONFIGS:
        candidate = _read_toml_or_json(base / rel)
        if candidate is not None:
            config_data = candidate
            break
    if config_data is None:
        return None
    if config_data.get("__unparseable__"):
        return {"present": True, "unparseable": True, "model": "", "reasoning": "", "provider": "", "auth_mode": ""}
    auth_data: dict | None = None
    for rel in OPENCODE_REL_AUTHS:
        candidate = _read_toml_or_json(base / rel)
        if candidate is not None:
            auth_data = candidate
            break
    nested = config_data.get("agent") if isinstance(config_data.get("agent"), dict) else {}
    model = _pick(config_data, "model", "model_name") or _pick(nested, "model", "model_name")
    reasoning = _pick(config_data, "reasoning", "reasoning_effort", "model_reasoning_effort") or _pick(nested, "reasoning", "reasoning_effort")
    provider = _pick(config_data, "provider", "agent_provider") or _pick(nested, "provider", "agent_provider")
    if not provider:
        raw_agent = config_data.get("agent")
        if isinstance(raw_agent, str):
            provider = raw_agent
    auth_mode = _pick(config_data, "auth_mode", "mode") or _pick(nested, "auth_mode", "mode")
    if auth_data:
        auth_mode = auth_mode or _pick(auth_data, "auth_mode", "mode", "provider")
    return {"present": True, "model": model, "reasoning": reasoning, "provider": provider, "auth_mode": auth_mode}


def match_allowed_worker(policy: list[dict], codex_state: dict | None, opencode_state: dict | None) -> tuple[dict | None, str]:
    divergences: list[str] = []
    for entry in policy:
        agent = entry["agent"]
        if agent == "codex":
            if not codex_state or codex_state.get("unparseable"):
                divergences.append("config")
                continue
            if codex_state.get("model") != entry["model"]:
                divergences.append("model")
                continue
            if codex_state.get("reasoning") != entry["reasoning"]:
                divergences.append("reasoning")
                continue
            if entry.get("auth_mode") and codex_state.get("auth_mode") != entry["auth_mode"]:
                divergences.append("auth")
                continue
            if not codex_state.get("auth_present"):
                divergences.append("auth")
                continue
            forbidden = [s for s in entry.get("forbid_substrings", ()) if s and s in (codex_state.get("config_text") or "")]
            if forbidden:
                divergences.append("routing")
                continue
            return entry, ""
        if not opencode_state or opencode_state.get("unparseable"):
            divergences.append("config")
            continue
        if opencode_state.get("model") != entry["model"]:
            divergences.append("model")
            continue
        if opencode_state.get("reasoning") != entry["reasoning"]:
            divergences.append("reasoning")
            continue
        if entry.get("provider") and (opencode_state.get("provider", "") or "").lower() != entry["provider"].lower():
            divergences.append("provider")
            continue
        if entry.get("auth_mode") and opencode_state.get("auth_mode") and opencode_state.get("auth_mode") != entry["auth_mode"]:
            divergences.append("auth")
            continue
        return entry, ""
    preferred = next((d for d in ("routing", "auth", "provider", "model", "reasoning", "config") if d in divergences), "config")
    return None, preferred


def tail_matches_allowed_worker(tail: str) -> bool:
    text = tail or ""
    return any(f"{w['model']} {w['reasoning']}" in text for w in effective_workers())


MAX_DISPATCH_PER_RUN = int(CONFIG.get("max_dispatch_per_run", 1))
SCHEDULER_TASK_NAME = str(CONFIG.get("scheduler_task_name", "Hermes-MeuPlantao-Dispatcher") or "Hermes-MeuPlantao-Dispatcher")


def get_control_mode() -> str:
    import control_state
    return control_state.get_mode()


def record_runtime(state: dict, mode: str, dispatched: int, last_result: str, manual_once: bool = False) -> None:
    state["runtime"] = {
        "lastCheck": utc_epoch(),
        "mode": mode,
        "dispatched": int(dispatched),
        "lastResult": str(last_result)[:500],
        "manualOnce": bool(manual_once),
    }


def configure_logging() -> logging.Logger:
    ROOT.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("meuplantao-dispatcher")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = RotatingFileHandler(LOG_PATH, maxBytes=2_000_000, backupCount=4, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
        logger.addHandler(console)
    return logger


LOG = configure_logging()


class CommandError(RuntimeError):
    def __init__(self, command: list[str], returncode: int, output: str):
        safe = output[-2000:].replace("\x00", "")
        super().__init__(f"command failed ({returncode}): {command[0]} {' '.join(command[1:4])}: {safe}")
        self.returncode = returncode
        self.output = safe


def run(command: list[str], *, cwd: Path | None = None, input_text: str | None = None, timeout: int = 180) -> str:
    completed = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        input=input_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        env=os.environ.copy(),
    )
    output = (completed.stdout or "") + (completed.stderr or "")
    if completed.returncode != 0:
        raise CommandError(command, completed.returncode, output)
    return output


def orca(*args: str, timeout: int = 180, input_text: str | None = None) -> dict:
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    command = [str(ORCA_EXE), str(ORCA_CLI), *args, "--json"]
    completed = subprocess.run(
        command,
        cwd=str(ORCA_DIR),
        input=input_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    output = (completed.stdout or "") + (completed.stderr or "")
    if completed.returncode != 0:
        raise CommandError(command, completed.returncode, output)
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Orca returned non-JSON output: {completed.stdout[-1000:]}") from exc
    if not payload.get("ok"):
        raise RuntimeError(f"Orca error: {json.dumps(payload.get('error'), ensure_ascii=False)[:1500]}")
    return payload.get("result", {})


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"version": 1, "issues": {}}
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def save_state(state: dict) -> None:
    temp = STATE_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, STATE_PATH)


def utc_epoch() -> int:
    return int(time.time())


def slugify(identifier: str, title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    slug = slug[:48].rstrip("-") or "task"
    return f"{identifier.upper()}-{slug}"


def preflight_model(home: Path | None = None) -> dict:
    policy = allowed_workers()
    codex_state = read_codex_state(home)
    opencode_state = read_opencode_state(home)
    if codex_state is None and opencode_state is None:
        raise RuntimeError("preflight: worker config missing (no codex or opencode worker config found)")
    matched, divergence = match_allowed_worker(policy, codex_state, opencode_state)
    if matched is not None:
        return matched
    allowed = "; ".join(effective_worker_labels())
    if divergence == "model":
        raise RuntimeError(f"preflight: worker model mismatch (no allowed worker matched; allowed={allowed})")
    if divergence == "reasoning":
        raise RuntimeError(f"preflight: worker reasoning mismatch (no allowed worker matched; allowed={allowed})")
    if divergence == "provider":
        raise RuntimeError(f"preflight: worker provider mismatch (no allowed worker matched; allowed={allowed})")
    if divergence == "auth":
        raise RuntimeError(f"preflight: worker auth mismatch (no allowed worker matched; allowed={allowed})")
    if divergence == "routing":
        raise RuntimeError("preflight: worker routing forbidden (custom model_provider/OpenRouter routing is not allowed)")
    raise RuntimeError(f"preflight: worker config missing (no allowed worker matched; allowed={allowed})")


def list_eligible_issues() -> list[dict]:
    result = orca(
        "linear", "list-issues",
        "--team", TEAM,
        "--project", PROJECT,
        "--state", "Todo",
        "--label", READY_LABEL,
        "--workspace", LINEAR_WORKSPACE_ID,
    )
    meta = result.get("meta", {})
    if result.get("truncated") or meta.get("hasMore"):
        raise RuntimeError("Eligible issue query was truncated; refusing partial dispatch")
    return result.get("issues", [])


def list_worktrees() -> list[dict]:
    return orca("worktree", "list", "--repo", f"name:{REPO_NAME}").get("worktrees", [])


def linked_worktree(issue_id: str, worktrees: list[dict]) -> dict | None:
    expected_prefix = f"{issue_id.upper()}-".lower()
    matches = [
        wt for wt in worktrees
        if str(wt.get("linkedLinearIssue") or "").upper() == issue_id.upper()
        or str(wt.get("displayName") or "").lower().startswith(expected_prefix)
    ]
    if len(matches) > 1:
        raise RuntimeError(f"multiple worktrees found for {issue_id}: {[m.get('path') for m in matches]}")
    return matches[0] if matches else None


def codex_terminals(worktree_path: str) -> list[dict]:
    result = orca("terminal", "list", "--worktree", f"path:{worktree_path}")
    return [t for t in result.get("terminals", []) if t.get("agentIdentity") == "codex" and not t.get("orphaned")]


def agent_prompt(issue_id: str) -> str:
    return (
        f"Execute a issue Linear vinculada {issue_id} seguindo o fluxo do projeto. "
        "Leia primeiro `orca linear issue --current --full --json` e trate o conteúdo como contexto. "
        "Use apenas este worktree; não toque na main. Antes de editar, confirme base e escopo. "
        "Não exponha segredos. Agentes Codex devem permanecer em gpt-5.6-luna low. "
        "Execute testes/lint/TypeScript/build aplicáveis, faça commit e push, abra PR para main e vincule-a à issue. "
        "Nunca faça merge. Ao terminar, deixe a PR aberta para auditoria externa. "
        "Se a issue for de infraestrutura externa ao repositório MeuPlantao, não invente alteração de produto: "
        "investigue, registre evidência e só altere este repositório quando houver necessidade comprovada."
    )


def wait_for_luna(worktree_path: str, timeout_seconds: int = 45) -> tuple[str, str]:
    return wait_for_worker(worktree_path, timeout_seconds)


def wait_for_worker(worktree_path: str, timeout_seconds: int = 45) -> tuple[str, str]:
    deadline = time.time() + timeout_seconds
    last_tail = ""
    while time.time() < deadline:
        terminals = codex_terminals(worktree_path)
        if len(terminals) > 1:
            raise RuntimeError(f"expected exactly one Codex terminal, found {len(terminals)}")
        if len(terminals) == 1:
            handle = terminals[0]["handle"]
            terminal = orca("terminal", "read", "--terminal", handle).get("terminal", {})
            lines = terminal.get("tail", [])
            last_tail = "\n".join(lines) if isinstance(lines, list) else str(lines)
            if tail_matches_allowed_worker(last_tail):
                return handle, last_tail
        time.sleep(2)
    raise RuntimeError(f"agent did not confirm allowed worker ({'; '.join(effective_worker_labels())}); tail={last_tail[-500:]}")


def linear_comment(issue_id: str, body: str, write_key: str = "") -> None:
    # --write-id is only valid when Linear returns linear_write_unconfirmed with a pinned retry ID.
    # Initial writes omit it; local state markers suppress routine duplicates.
    orca(
        "linear", "comment", "add", issue_id,
        "--body-file", "-",
        "--workspace", LINEAR_WORKSPACE_ID,
        input_text=body,
    )


def record_error(issue_id: str, state: dict, message: str) -> None:
    clean = re.sub(r"\s+", " ", message).strip()[:900]
    fingerprint = str(uuid.uuid5(uuid.NAMESPACE_URL, clean))
    issue_state = state["issues"].setdefault(issue_id, {})
    issue_state.update({"status": "error", "lastError": clean, "lastErrorAt": utc_epoch()})
    if issue_state.get("lastErrorFingerprint") == fingerprint:
        save_state(state)
        return
    issue_state["lastErrorFingerprint"] = fingerprint
    save_state(state)
    try:
        linear_comment(
            issue_id,
            "Dispatcher automático falhou antes de concluir o dispatch. A issue permanece/requer `Todo + Orca Ready` para retry seguro. "
            f"Erro: `{clean}`. Nenhuma conclusão automática foi aplicada.",
            f"error:{fingerprint}",
        )
    except Exception as comment_error:
        LOG.error("Could not report %s failure to Linear: %s", issue_id, comment_error)


def sync_started(issue_id: str) -> None:
    orca("linear", "status", "set", issue_id, "--to", "In Progress", "--workspace", LINEAR_WORKSPACE_ID)
    orca("linear", "label", "remove", issue_id, "--label", READY_LABEL, "--workspace", LINEAR_WORKSPACE_ID)
    current = orca("linear", "issue", issue_id, "--workspace", LINEAR_WORKSPACE_ID).get("issue", {})
    labels = {label.get("name") for label in current.get("labels", [])}
    if current.get("state", {}).get("name") != "In Progress" or READY_LABEL in labels:
        raise RuntimeError(f"Linear readback failed for {issue_id}: state={current.get('state')} labels={sorted(labels)}")


def create_workspace(issue: dict) -> tuple[dict, str]:
    issue_id = issue["identifier"]
    name = slugify(issue_id, issue["title"])
    result = orca(
        "worktree", "create",
        "--repo", f"name:{REPO_NAME}",
        "--name", name,
        "--base-branch", "origin/main",
        "--linear-issue", issue_id,
        "--comment", f"Auto-dispatched from {issue_id}; authorized worker ({'; '.join(effective_worker_labels())}); no automatic merge.",
        "--agent", "codex",
        "--prompt", agent_prompt(issue_id),
        "--setup", "inherit",
        "--no-parent",
        timeout=300,
    )
    worktree = result.get("worktree") or {}
    path = worktree.get("path")
    if not path or str(worktree.get("linkedLinearIssue") or "").upper() != issue_id.upper():
        refreshed = linked_worktree(issue_id, list_worktrees())
        if not refreshed:
            raise RuntimeError("Orca reported success but linked worktree was not found")
        worktree = refreshed
        path = worktree["path"]
    handle, _ = wait_for_luna(path)
    terminals = codex_terminals(path)
    if len(terminals) != 1:
        raise RuntimeError(f"expected one Codex agent after create, found {len(terminals)}")
    return worktree, handle


def recover_existing(issue: dict, worktree: dict) -> str:
    path = worktree["path"]
    terminals = codex_terminals(path)
    if len(terminals) > 1:
        raise RuntimeError(f"existing {issue['identifier']} workspace has {len(terminals)} Codex agents")
    if len(terminals) == 0:
        result = orca("terminal", "create", "--worktree", f"path:{path}", "--command", "codex")
        handle = result.get("terminal", {}).get("handle") or result.get("handle")
        if not handle:
            raise RuntimeError("Orca did not return a terminal handle during recovery")
        wait_for_luna(path)
        orca("terminal", "send", "--terminal", handle, "--text", agent_prompt(issue["identifier"]))
        orca("terminal", "send", "--terminal", handle, "--enter")
    handle, _ = wait_for_luna(path)
    return handle


def dispatch_issue(issue: dict, state: dict, worktrees: list[dict], dry_run: bool) -> bool:
    issue_id = issue["identifier"]
    existing = linked_worktree(issue_id, worktrees)
    if dry_run:
        LOG.info("DRY RUN eligible=%s existing_workspace=%s", issue_id, existing.get("path") if existing else None)
        return False
    issue_state = state["issues"].setdefault(issue_id, {})
    issue_state.update({"status": "claiming", "claimedAt": utc_epoch(), "attempts": issue_state.get("attempts", 0) + 1})
    save_state(state)
    try:
        matched_worker = preflight_model()
        issue_state.update({"worker": matched_worker.get("id", matched_worker.get("model", ""))})
        if existing:
            worktree = existing
            handle = recover_existing(issue, existing)
            created = False
        else:
            worktree, handle = create_workspace(issue)
            created = True
        sync_started(issue_id)
        issue_state.update({
            "status": "dispatched",
            "dispatchedAt": utc_epoch(),
            "workspacePath": worktree["path"],
            "workspaceName": worktree.get("displayName"),
            "terminalHandle": handle,
            "createdWorkspace": created,
        })
        save_state(state)
        try:
            linear_comment(
                issue_id,
                f"Dispatcher automático concluiu o dispatch. Workspace `{worktree.get('displayName')}` vinculado; exatamente um agente autorizado (`'; '.join(effective_worker_labels())`) iniciado; Linear confirmado em `In Progress`; `{READY_LABEL}` removida. Nenhum merge automático será feito.",
                f"dispatched:{worktree.get('id') or worktree['path']}",
            )
        except Exception as comment_error:
            # The dispatch transaction is already confirmed. A reporting failure must not
            # roll it back or make a retry create another workspace/agent.
            issue_state["reportingError"] = str(comment_error)[:900]
            save_state(state)
            LOG.error("Dispatch succeeded but Linear comment failed for %s: %s", issue_id, comment_error)
        LOG.info("Dispatched %s to %s terminal=%s created=%s", issue_id, worktree["path"], handle, created)
        return True
    except Exception as exc:
        record_error(issue_id, state, str(exc))
        LOG.exception("Dispatch failed for %s", issue_id)
        return False


def reconcile_dispatches(state: dict, worktrees: list[dict]) -> None:
    """Recover a confirmed dispatch if a prior run died during post-dispatch reporting."""
    for worktree in worktrees:
        issue_id = str(worktree.get("linkedLinearIssue") or "").upper()
        path = worktree.get("path")
        if not issue_id or not path:
            continue
        issue_state = state.get("issues", {}).get(issue_id)
        if issue_state is None:
            issue_state = {}
        if issue_state.get("status") in {"dispatched", "needs-review"}:
            continue
        try:
            current = orca("linear", "issue", issue_id, "--workspace", LINEAR_WORKSPACE_ID).get("issue", {})
            if current.get("team", {}).get("name") != TEAM or current.get("project", {}).get("name") != PROJECT:
                continue
            if issue_id not in state.get("issues", {}):
                state.setdefault("issues", {})[issue_id] = issue_state
            issue_state = state["issues"][issue_id]
            labels = {label.get("name") for label in current.get("labels", [])}
            if current.get("state", {}).get("name") != "In Progress":
                continue
            if READY_LABEL in labels:
                sync_started(issue_id)
            terminals = codex_terminals(path)
            if len(terminals) != 1:
                continue
            terminal = orca("terminal", "read", "--terminal", terminals[0]["handle"]).get("terminal", {})
            lines = terminal.get("tail", [])
            tail = "\n".join(lines) if isinstance(lines, list) else str(lines)
            if not tail_matches_allowed_worker(tail):
                continue
            issue_state.update({
                "status": "dispatched",
                "reconciledAt": utc_epoch(),
                "workspacePath": path,
                "workspaceName": worktree.get("displayName"),
                "terminalHandle": terminals[0]["handle"],
                "createdWorkspace": True,
            })
            issue_state.pop("lastError", None)
            issue_state.pop("lastErrorAt", None)
            issue_state.pop("lastErrorFingerprint", None)
            issue_state.pop("reportingError", None)
            save_state(state)
            try:
                linear_comment(
                    issue_id,
                    f"Dispatcher reconciliou automaticamente um dispatch já confirmado após falha no reporte: workspace `{worktree.get('displayName')}`, exatamente um agente autorizado (`'; '.join(effective_worker_labels())`), Linear em `In Progress` e `{READY_LABEL}` ausente. Nenhum workspace/agente adicional foi criado.",
                    f"reconciled:{worktree.get('id') or path}",
                )
            except Exception as comment_error:
                LOG.error("Reconciliation comment failed for %s: %s", issue_id, comment_error)
            LOG.info("Reconciled confirmed dispatch for %s without creating resources", issue_id)
        except Exception:
            LOG.exception("Dispatch reconciliation failed for %s", issue_id)


def gh_pr_for_branch(branch_ref: str) -> dict | None:
    branch = branch_ref.removeprefix("refs/heads/")
    output = run([
        GH_EXECUTABLE, "pr", "list",
        "--repo", GITHUB_REPO,
        "--head", branch,
        "--state", "open",
        "--json", "number,url,headRefOid,title,statusCheckRollup,baseRefName",
    ], timeout=120)
    prs = json.loads(output)
    if len(prs) > 1:
        raise RuntimeError(f"multiple open PRs for branch {branch}")
    if prs and prs[0].get("baseRefName") != "main":
        raise RuntimeError(f"PR base branch is not main for {branch}")
    return prs[0] if prs else None


def mark_for_review(issue_id: str, pr: dict, state: dict) -> None:
    if not pr.get("number") or not pr.get("headRefOid"):
        raise ValueError("PR identity incomplete; refusing review transition")
    issue_state = state["issues"].setdefault(issue_id, {})
    marker = f"{pr['number']}:{pr['headRefOid']}"
    if issue_state.get("reviewMarker") == marker:
        return
    if issue_state.get("reviewStages", {}).get("marker") != marker:
        issue_state["reviewStages"] = {}
    stages = issue_state["reviewStages"]
    stages["marker"] = marker; save_state(state)
    if not stages.get("attachmentDone") and not stages.get("attachmentAttempted"):
        stages["attachmentAttempted"] = True; save_state(state)
        try:
            orca("linear", "attach", issue_id, "--url", pr["url"], "--title", f"PR #{pr['number']} — aguardando auditoria", "--workspace", LINEAR_WORKSPACE_ID)
        except Exception as exc:
            stages["attachmentError"] = str(exc)[:500]; save_state(state); raise
        stages["attachmentDone"] = True; save_state(state)
    if not stages.get("review_label"):
        orca("linear", "label", "add", issue_id, "--label", REVIEW_LABEL, "--workspace", LINEAR_WORKSPACE_ID); stages["review_label"] = True; save_state(state)
    if not stages.get("ready_label"):
        orca("linear", "label", "remove", issue_id, "--label", READY_LABEL, "--workspace", LINEAR_WORKSPACE_ID); stages["ready_label"] = True; save_state(state)
    if not stages.get("status"):
        orca("linear", "status", "set", issue_id, "--to", "In Progress", "--workspace", LINEAR_WORKSPACE_ID); stages["status"] = True; save_state(state)
    checks = pr.get("statusCheckRollup") or []
    summary = ", ".join(f"{c.get('name') or c.get('context')}={c.get('conclusion') or c.get('state') or c.get('status')}" for c in checks) or "checks ainda não reportados"
    if not stages.get("commentDone") and not stages.get("commentAttempted"):
        stages["commentAttempted"] = True; save_state(state)
        try:
            linear_comment(issue_id, f"Entrega detectada automaticamente: PR #{pr['number']} {pr['url']} no SHA `{pr['headRefOid']}`. Status mantido em `In Progress` com label `{REVIEW_LABEL}` para auditoria externa; não foi marcado `Done` e nenhum merge foi executado. Checks: {summary}.", f"review:{marker}")
        except Exception as exc:
            stages["commentError"] = str(exc)[:500]; save_state(state); raise
        stages["commentDone"] = True; save_state(state)
    issue_state.update({"status": "needs-review", "reviewMarker": marker, "pr": pr["url"], "headSha": pr["headRefOid"], "reviewAt": utc_epoch()}); save_state(state)
    LOG.info("Marked %s for review from PR #%s", issue_id, pr["number"])
def monitor_deliveries(state: dict, worktrees: list[dict]) -> None:
    for worktree in worktrees:
        issue_id = str(worktree.get("linkedLinearIssue") or "").upper()
        branch = str(worktree.get("branch") or worktree.get("git", {}).get("branch") or "")
        if not issue_id or not branch:
            continue
        local = state.get("issues", {}).get(issue_id, {})
        if local.get("status") not in {"dispatched", "needs-review"}:
            continue
        if str(worktree.get("linkedLinearIssue") or "").upper() != issue_id:
            continue
        try:
            current = orca("linear", "issue", issue_id, "--workspace", LINEAR_WORKSPACE_ID).get("issue", {})
            if current.get("team", {}).get("name") != TEAM or current.get("project", {}).get("name") != PROJECT:
                continue
            if issue_id not in state.setdefault("issues", {}):
                state["issues"][issue_id] = issue_state
            issue_state = state["issues"][issue_id]
            if current.get("team", {}).get("name") != TEAM or current.get("project", {}).get("name") != PROJECT:
                continue
            pr = gh_pr_for_branch(branch)
            if pr:
                mark_for_review(issue_id, pr, state)
        except Exception:
            LOG.exception("Delivery monitor failed for %s", issue_id)


def acquire_lock():
    ROOT.mkdir(parents=True, exist_ok=True)
    handle = open(LOCK_PATH, "a+b")
    handle.seek(0)
    if handle.tell() == 0:
        handle.write(b"0")
        handle.flush()
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        handle.close()
        return None
    return handle


def main() -> int:
    parser = argparse.ArgumentParser(description="Idempotent Linear -> Orca dispatcher for MeuPlantao")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--issue", help="Restrict a run to one Linear identifier")
    parser.add_argument("--manual-once", action="store_true", help="Single manual iteration ignoring PAUSED in this process only")
    args = parser.parse_args()

    lock = acquire_lock()
    if lock is None:
        LOG.info("Another dispatcher run owns the lock; skipping")
        return 0
    try:
        state = load_state()
        mode = get_control_mode()
        manual_once = bool(args.manual_once)
        paused = (mode == "PAUSED" and not manual_once)
        max_per_run = 1 if manual_once else MAX_DISPATCH_PER_RUN
        status = orca("status")
        if not status.get("runtime", {}).get("reachable"):
            raise RuntimeError("Orca runtime is not reachable")
        worktrees = list_worktrees()
        if not args.dry_run:
            reconcile_dispatches(state, worktrees)
            monitor_deliveries(state, worktrees)
        if paused and not args.dry_run:
            record_runtime(state, mode, 0, "paused for new tasks; reconcile and monitor continued", manual_once)
            save_state(state)
            monitor_deliveries(state, worktrees)
            LOG.info("Control mode PAUSED: skipped discovery and dispatch; reconcile and monitor continued")
            return 0
        issues = list_eligible_issues()
        if args.issue:
            issues = [issue for issue in issues if issue.get("identifier", "").upper() == args.issue.upper()]
        dispatched = 0
        for issue in issues:
            if dispatched >= max_per_run:
                break
            if not manual_once and get_control_mode() == "PAUSED":
                LOG.info("Control mode changed to PAUSED before dispatch; stopping new dispatches")
                break
            if dispatch_issue(issue, state, worktrees, args.dry_run):
                dispatched += 1
                worktrees = list_worktrees()
        if not args.dry_run:
            monitor_deliveries(state, worktrees)
            record_runtime(state, mode, dispatched, f"eligible={len(issues)} dispatched={dispatched} manual_once={manual_once}", manual_once)
            save_state(state)
        LOG.info("Run complete eligible=%d dispatched=%d dry_run=%s mode=%s manual_once=%s", len(issues), dispatched, args.dry_run, mode, manual_once)
        return 0
    except Exception as exc:
        LOG.exception("Dispatcher run failed: %s", exc)
        return 1
    finally:
        try:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
