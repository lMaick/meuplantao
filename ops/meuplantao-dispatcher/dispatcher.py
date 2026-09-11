from __future__ import annotations

import argparse
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import msvcrt
import os
from pathlib import Path
import re
import shlex
import subprocess
import shutil
import sys
import time
import traceback
import tomllib
import unicodedata
import uuid
from urllib.parse import unquote, urlsplit, urlunsplit

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
WORKER_ID_KEY = "worker_id"
CODEX_REL_CONFIG = Path(".codex/config.toml")
CODEX_REL_AUTH = Path(".codex/auth.json")
OPENCODE_REL_CONFIGS = (Path(".config/opencode/opencode.json"), Path(".opencode.json"), Path(".config/opencode.json"))
OPENCODE_REL_AUTHS = (Path(".config/opencode/auth.json"), Path(".local/share/opencode/auth.json"))
DEFAULT_FORBIDDEN_ROUTING = ("model_provider", "openrouter")
ORCA_SETTINGS_ENV = "MEUPLANTAO_ORCA_SETTINGS"
ORCA_SETTINGS_KEY = "orca_settings_path"
ORCA_USER_DATA_ENV = "ORCA_USER_DATA_PATH"
ORCA_PROFILE_INDEX_NAME = "orca-profile-index.json"
ORCA_PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
CODEX_WRAPPER_KEY = "codex"
WRAPPER_MODEL_FLAGS = ("--model",)
WRAPPER_PROVIDER_FLAGS = ("--provider",)
WRAPPER_REASONING_FLAGS = ("--reasoning", "--effort", "--reasoning-effort", "--reasoning_effort")
WRAPPER_EXECUTABLE_RE = re.compile(r"^[A-Za-z0-9._+-]+$")
WRAPPER_SHELL_OPERATORS = frozenset({"&", "&&", "|", "||", ";", ">", ">>", "<", "<<", "(", ")", "`"})
WRAPPER_TOKEN_METACHARS = frozenset(list(";&|><$`'\"\\(){}[]*?!~#") + ["\n", "\r", "\x00"])
WRAPPER_MODE_COMMAND_FLAGS = "command_flags"
WRAPPER_MODE_SCRIPT_WRAPPER = "script_wrapper"
SUPPORTED_WRAPPER_MODES = (WRAPPER_MODE_COMMAND_FLAGS, WRAPPER_MODE_SCRIPT_WRAPPER)
SHA256_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")
ALLOWED_SCRIPT_WRAPPER_EXTENSIONS = (".cmd", ".bat")
AUDITED_DEFAULT_ARGS_ALLOWLIST = frozenset({"", "--dangerously-bypass-approvals-and-sandbox"})
DEFAULT_ALLOWED_SCRIPT_WRAPPER_ARGS = ("", "--dangerously-bypass-approvals-and-sandbox")
EXPECTED_OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1"
EXPECTED_OPENCODE_GO_ENV_KEY = "OPENCODE_API_KEY"
EXPECTED_OPENCODE_GO_WIRE_API = "responses"
CODEX_CALL_NAMES = frozenset({"codex.cmd", "codex.bat", "codex.exe", "codex"})


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
        worker_id = str(entry.get("id", "") or "").strip()
        model = str(entry.get("model", "") or "").strip()
        reasoning = str(entry.get("reasoning", "") or "").strip()
        command = str(entry.get("command", "") or "").strip()
        identity = str(entry.get("identity", "") or "").strip()
        auth_mode = str(entry.get("auth_mode", "") or "").strip()
        if not worker_id or not model or not reasoning or not command or not identity or not auth_mode:
            raise RuntimeError(f"preflight: worker policy entry {index} missing id/model/reasoning/command/identity/auth_mode")
        agent = str(entry.get("agent", "") or "").strip()
        provider = str(entry.get("provider", "") or "").strip()
        wrapper_mode = str(entry.get("wrapper_mode", "") or "").strip().lower()
        if not wrapper_mode:
            wrapper_mode = WRAPPER_MODE_COMMAND_FLAGS
        if wrapper_mode not in SUPPORTED_WRAPPER_MODES:
            raise RuntimeError(
                f"preflight: worker policy entry {index} invalid wrapper_mode"
                f" (expected one of {SUPPORTED_WRAPPER_MODES}; got {wrapper_mode})"
            )
        wrapper_executable = str(entry.get("wrapper_executable", "") or "").strip()
        wrapper_path = str(entry.get("wrapper_path", "") or "").strip()
        wrapper_sha256 = str(entry.get("wrapper_sha256", "") or "").strip().lower()

        if wrapper_mode == WRAPPER_MODE_SCRIPT_WRAPPER:
            if not wrapper_path:
                raise RuntimeError(f"preflight: worker policy entry {index} missing wrapper_path")
            if not wrapper_sha256 or not SHA256_HEX_RE.match(wrapper_sha256):
                raise RuntimeError(f"preflight: worker policy entry {index} missing or invalid wrapper_sha256")
        else:
            if wrapper_executable and not WRAPPER_EXECUTABLE_RE.match(wrapper_executable):
                raise RuntimeError(
                    f"preflight: worker policy entry {index} malformed"
                    " (wrapper_executable must be a bare executable name)"
                )
            if agent == "codex" and provider and not wrapper_executable:
                raise RuntimeError(
                    f"preflight: worker policy entry {index} missing wrapper_executable"
                    " (wrapper-routed codex requires an explicit executable)"
                )
        forbid = entry.get("forbid_substrings", None)
        if forbid is None:
            forbid = list(DEFAULT_FORBIDDEN_ROUTING) if agent == "codex" else []
        forbid_tuple = tuple(str(item).lower() for item in forbid) if isinstance(forbid, (list, tuple)) else ()

        allowed_args_raw = entry.get("allowed_default_args", None)
        if wrapper_mode == WRAPPER_MODE_SCRIPT_WRAPPER:
            if allowed_args_raw is not None:
                parsed_args = tuple(str(x) for x in allowed_args_raw) if isinstance(allowed_args_raw, (list, tuple)) else (str(allowed_args_raw),)
                for arg in parsed_args:
                    if arg not in AUDITED_DEFAULT_ARGS_ALLOWLIST:
                        raise RuntimeError(
                            f"preflight: worker policy entry {index} unauthorized allowed_default_args"
                            f" (cannot expand beyond audited allowlist: {sorted(AUDITED_DEFAULT_ARGS_ALLOWLIST)})"
                        )
                allowed_args = parsed_args
            else:
                allowed_args = DEFAULT_ALLOWED_SCRIPT_WRAPPER_ARGS
        else:
            allowed_args = ("",)

        normalized.append({
            "id": worker_id,
            "agent": agent,
            "model": model,
            "reasoning": reasoning,
            "provider": provider,
            "command": command,
            "identity": identity,
            "auth_mode": auth_mode,
            "wrapper_mode": wrapper_mode,
            "wrapper_executable": wrapper_executable,
            "wrapper_path": wrapper_path,
            "wrapper_sha256": wrapper_sha256,
            "allowed_default_args": allowed_args,
            "forbid_substrings": forbid_tuple,
            "runtime_env_source": entry.get("runtime_env_source"),
            "runtime_env_file": entry.get("runtime_env_file"),
        })
    return normalized


def selected_worker(config: dict | None = None) -> dict:
    source = config if config is not None else CONFIG
    policy = allowed_workers(source)
    worker_id = str(source.get(WORKER_ID_KEY, "") or "").strip()
    if not worker_id:
        raise RuntimeError("preflight: worker_id missing (declare worker_id selecting one [[allowed_workers]] entry)")
    matches = [entry for entry in policy if entry["id"] == worker_id]
    if len(matches) == 0:
        known = ", ".join(sorted({entry["id"] for entry in policy}))
        raise RuntimeError(f"preflight: unknown worker_id (no [[allowed_workers]] entry matches; known={known})")
    if len(matches) > 1:
        raise RuntimeError("preflight: duplicate worker_id (multiple [[allowed_workers]] entries share the id)")
    return matches[0]


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
        return {"__unparseable__": True}


def read_codex_state(home: Path | None = None) -> dict | None:
    base = home or Path.home()
    config_path = base / CODEX_REL_CONFIG
    auth_path = base / CODEX_REL_AUTH
    config = _read_toml_or_json(config_path)
    if config is None:
        return None
    if config.get("__unparseable__"):
        return {"present": True, "unparseable": True, "config_text": "", "model": "", "reasoning": "", "auth_mode": "", "auth_present": False}
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
        "auth_present": auth is not None and not (isinstance(auth, dict) and auth.get("__unparseable__")),
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
        return {"present": True, "unparseable": True, "model": "", "reasoning": "", "provider": "", "auth_mode": "", "auth_present": False}
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
    auth_ok = isinstance(auth_data, dict) and not auth_data.get("__unparseable__")
    if auth_ok:
        auth_mode = auth_mode or _pick(auth_data, "auth_mode", "mode", "provider")
    return {"present": True, "model": model, "reasoning": reasoning, "provider": provider, "auth_mode": auth_mode, "auth_present": bool(auth_ok)}


def is_codex_worker(entry: dict) -> bool:
    return entry.get("agent") == "codex"


def is_wrapper_codex_worker(entry: dict) -> bool:
    return entry.get("agent") == "codex" and bool(str(entry.get("provider", "") or "").strip())


def orca_settings_path(config: dict | None = None, explicit: Path | str | None = None) -> Path | None:
    if explicit is not None and str(explicit).strip():
        return Path(os.path.expandvars(str(explicit))).expanduser()
    env_value = str(os.environ.get(ORCA_SETTINGS_ENV, "") or "").strip()
    if env_value:
        return Path(os.path.expandvars(env_value)).expanduser()
    source = config if config is not None else CONFIG
    if isinstance(source, dict):
        configured = str(source.get(ORCA_SETTINGS_KEY, "") or "").strip()
        if configured:
            return Path(os.path.expandvars(configured)).expanduser()
    return None


def load_orca_settings(settings_path: Path | str, worker_id: str) -> dict:
    try:
        text = Path(settings_path).read_text(encoding="utf-8")
    except OSError:
        raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")
    try:
        data = json.loads(text)
    except Exception:
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    if not isinstance(data, dict):
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    return data


def orca_user_data_dir(worker_id: str) -> Path:
    override = str(os.environ.get(ORCA_USER_DATA_ENV, "") or "").strip()
    if override:
        return Path(os.path.expandvars(override)).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "orca"
    if sys.platform == "win32":
        appdata = str(os.environ.get("APPDATA", "") or "").strip()
        if not appdata:
            raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")
        return Path(appdata) / "orca"
    base = str(os.environ.get("XDG_CONFIG_HOME", "") or "").strip()
    return (Path(base) if base else Path.home() / ".config") / "orca"


def discover_authoritative_orca_settings(worker_id: str, user_data: Path | None = None) -> Path:
    base = user_data or orca_user_data_dir(worker_id)
    for candidate in (base / ORCA_PROFILE_INDEX_NAME, base / (ORCA_PROFILE_INDEX_NAME + ".bak")):
        try:
            parsed = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(parsed, dict) or not isinstance(parsed.get("profiles"), list):
            continue
        profile_id = parsed.get("activeProfileId")
        if not isinstance(profile_id, str) or not ORCA_PROFILE_ID_RE.match(profile_id):
            continue
        if not any(isinstance(item, dict) and item.get("id") == profile_id for item in parsed["profiles"]):
            continue
        return base / "profiles" / profile_id / "orca-data.json"
    return base / "orca-data.json"


def _same_settings_file(left: Path | str, right: Path | str) -> bool:
    try:
        return os.path.normcase(str(Path(left).resolve())) == os.path.normcase(str(Path(right).resolve()))
    except OSError:
        return os.path.normcase(os.path.abspath(str(left))) == os.path.normcase(os.path.abspath(str(right)))


def resolve_wrapper_settings_path(worker_id: str, explicit: Path | str | None = None) -> Path:
    authoritative = discover_authoritative_orca_settings(worker_id)
    pinned = orca_settings_path(explicit=explicit)
    if pinned is not None and not _same_settings_file(pinned, authoritative):
        raise RuntimeError(f"preflight: codex wrapper not authoritative (worker_id={worker_id})")
    return authoritative


def extract_codex_override(settings_data: dict, worker_id: str):
    if "agentCmdOverrides" in settings_data:
        raise RuntimeError(f"preflight: codex wrapper ambiguous (worker_id={worker_id})")
    nested = settings_data.get("settings")
    if not isinstance(nested, dict):
        raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")
    overrides_raw = nested.get("agentCmdOverrides")
    if overrides_raw is None or (isinstance(overrides_raw, dict) and CODEX_WRAPPER_KEY not in overrides_raw):
        raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")
    if not isinstance(overrides_raw, dict):
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    raw = overrides_raw[CODEX_WRAPPER_KEY]
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")
    if isinstance(raw, str):
        return raw
    raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")


def require_empty_wrapper_default_args(settings_data: dict, worker_id: str) -> None:
    nested = settings_data.get("settings")
    args_record = nested.get("agentDefaultArgs") if isinstance(nested, dict) else None
    if not isinstance(args_record, dict) or CODEX_WRAPPER_KEY not in args_record:
        raise RuntimeError(f"preflight: codex wrapper default args missing (worker_id={worker_id})")
    value = args_record[CODEX_WRAPPER_KEY]
    if not isinstance(value, str) or value.strip():
        raise RuntimeError(f"preflight: codex wrapper unauthorized default args (worker_id={worker_id})")


def require_empty_wrapper_default_env(settings_data: dict, worker_id: str) -> None:
    nested = settings_data.get("settings")
    env_record = nested.get("agentDefaultEnv") if isinstance(nested, dict) else None
    if env_record is None or (isinstance(env_record, dict) and CODEX_WRAPPER_KEY not in env_record):
        return
    if not isinstance(env_record, dict):
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    value = env_record[CODEX_WRAPPER_KEY]
    if value is None:
        return
    if not isinstance(value, dict):
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    remaining = {name: item for name, item in value.items() if str(name).strip() and isinstance(item, str)}
    if remaining:
        raise RuntimeError(f"preflight: codex wrapper unauthorized default env (worker_id={worker_id})")


def _parse_wrapper_flags(tokens: list, worker_id: str) -> dict:
    model_vals: list = []
    provider_vals: list = []
    reasoning_vals: list = []
    consumed: set = set()
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if not isinstance(token, str) or not token:
            raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
        if token in WRAPPER_SHELL_OPERATORS or any(ch in WRAPPER_TOKEN_METACHARS for ch in token):
            raise RuntimeError(f"preflight: codex wrapper unauthorized token (worker_id={worker_id})")
        name = None
        value = None
        if token.startswith("--") and "=" in token:
            name, value = token.split("=", 1)
            lowered = name.lower()
            if lowered not in (*WRAPPER_MODEL_FLAGS, *WRAPPER_PROVIDER_FLAGS, *WRAPPER_REASONING_FLAGS):
                raise RuntimeError(f"preflight: codex wrapper unauthorized token (worker_id={worker_id})")
            consumed.add(index)
        elif token.lower() in (*WRAPPER_MODEL_FLAGS, *WRAPPER_PROVIDER_FLAGS, *WRAPPER_REASONING_FLAGS):
            name = token
            lowered = token.lower()
            if index + 1 >= len(tokens):
                raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
            value = tokens[index + 1]
            consumed.add(index)
            consumed.add(index + 1)
            index += 1
        elif token.startswith("-"):
            raise RuntimeError(f"preflight: codex wrapper unauthorized token (worker_id={worker_id})")
        else:
            index += 1
            continue
        if not isinstance(value, str):
            raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
        if any(ch in WRAPPER_TOKEN_METACHARS for ch in value):
            raise RuntimeError(f"preflight: codex wrapper unauthorized token (worker_id={worker_id})")
        cleaned = value.strip()
        if lowered in WRAPPER_MODEL_FLAGS:
            model_vals.append(cleaned)
        elif lowered in WRAPPER_PROVIDER_FLAGS:
            provider_vals.append(cleaned)
        elif lowered in WRAPPER_REASONING_FLAGS:
            reasoning_vals.append(cleaned)
        index += 1
    for pos in range(1, len(tokens)):
        if pos not in consumed:
            raise RuntimeError(f"preflight: codex wrapper unauthorized token (worker_id={worker_id})")
    if len(model_vals) > 1 or len(provider_vals) > 1 or len(reasoning_vals) > 1:
        raise RuntimeError(f"preflight: codex wrapper ambiguous (worker_id={worker_id})")
    if not model_vals or not provider_vals or not reasoning_vals:
        raise RuntimeError(f"preflight: codex wrapper field missing (worker_id={worker_id})")
    if not model_vals[0] or not provider_vals[0] or not reasoning_vals[0]:
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    executable = tokens[0].strip() if tokens else ""
    if not executable:
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    return {"executable": executable, "model": model_vals[0], "provider": provider_vals[0], "reasoning": reasoning_vals[0]}


def parse_wrapper_route(raw, worker_id: str) -> dict:
    if not isinstance(raw, str):
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    if isinstance(raw, str):
        if not raw.strip():
            raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")
        try:
            tokens = shlex.split(raw, posix=True)
        except ValueError:
            raise RuntimeError(f"preflight: codex wrapper ambiguous (worker_id={worker_id})")
        if not tokens:
            raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
        return _parse_wrapper_flags(tokens, worker_id)
    raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")


def read_codex_wrapper_route(
    entry: dict, home: Path | None = None, settings_path: Path | str | None = None
) -> dict:
    worker_id = str(entry.get("id", "") or "")
    if entry.get("command") != CODEX_WRAPPER_KEY or entry.get("identity") != CODEX_WRAPPER_KEY:
        raise RuntimeError(f"preflight: codex wrapper command not resolved (worker_id={worker_id})")
    resolved = resolve_wrapper_settings_path(worker_id, explicit=settings_path)
    settings_data = load_orca_settings(resolved, worker_id)
    raw = extract_codex_override(settings_data, worker_id)
    require_empty_wrapper_default_args(settings_data, worker_id)
    require_empty_wrapper_default_env(settings_data, worker_id)
    route = parse_wrapper_route(raw, worker_id)
    expected_executable = str(entry.get("wrapper_executable", "") or "")
    if not expected_executable or route.get("executable") != expected_executable:
        raise RuntimeError(f"preflight: codex wrapper command not resolved (worker_id={worker_id})")
    base = home or Path.home()
    auth_data: dict | None = None
    for rel in OPENCODE_REL_AUTHS:
        candidate = _read_toml_or_json(base / rel)
        if candidate is not None:
            auth_data = candidate
            break
    auth_present = isinstance(auth_data, dict) and not auth_data.get("__unparseable__")
    auth_mode = _pick(auth_data, "auth_mode", "mode", "provider") if isinstance(auth_data, dict) else ""
    return {
        "present": True,
        "wrapper": True,
        "command": CODEX_WRAPPER_KEY,
        "model": route["model"],
        "provider": route["provider"],
        "reasoning": route["reasoning"],
        "auth_present": auth_present,
        "auth_mode": auth_mode,
    }


def resolve_cmd_logical_lines(text: str) -> list[str]:
    raw_lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    logical_lines: list[str] = []
    current_parts: list[str] = []

    for line in raw_lines:
        trimmed_right = line.rstrip()
        if trimmed_right.endswith("^"):
            current_parts.append(trimmed_right[:-1].strip())
        else:
            current_parts.append(line.strip())
            joined = " ".join(part for part in current_parts if part).strip()
            if joined:
                logical_lines.append(joined)
            current_parts = []

    if current_parts:
        joined = " ".join(part for part in current_parts if part).strip()
        if joined:
            logical_lines.append(joined)

    return logical_lines


BATCH_CONTROL_METACHARS = ("&", "|", "<", ">")


def has_unquoted_batch_metachars(line: str) -> bool:
    in_quote = False
    quote_char = ""
    for char in line:
        if in_quote:
            if char == quote_char:
                in_quote = False
                quote_char = ""
        else:
            if char in ('"', "'"):
                in_quote = True
                quote_char = char
            elif char in BATCH_CONTROL_METACHARS:
                return True
    return False


def is_batch_comment(line: str) -> bool:
    stripped = line.strip()
    if stripped.startswith("::") or stripped.startswith("@::"):
        return True
    lowered = stripped.lower()
    return (
        lowered == "rem"
        or lowered.startswith("rem ")
        or lowered.startswith("rem\t")
        or lowered == "@rem"
        or lowered.startswith("@rem ")
        or lowered.startswith("@rem\t")
    )


def is_batch_echo(line: str) -> bool:
    stripped = line.strip()
    lowered = stripped.lower()
    return (
        lowered in ("@echo off", "echo off")
        or lowered.startswith("@echo ")
        or lowered.startswith("echo ")
        or lowered.startswith("@echo\t")
        or lowered.startswith("echo\t")
    )


def extract_effective_codex_command(text: str, worker_id: str) -> str:
    lines = resolve_cmd_logical_lines(text)
    executable_statements: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if is_batch_comment(stripped):
            continue

        # Reject control metacharacters outside quotes on any non-comment line
        if has_unquoted_batch_metachars(stripped):
            raise RuntimeError(f"preflight: codex wrapper ambiguous execution route (worker_id={worker_id})")

        if is_batch_echo(stripped):
            continue

        lowered = stripped.lower()
        first_word = lowered.split(None, 1)[0]
        if first_word in ("if", "goto", "for", "while", "do"):
            raise RuntimeError(f"preflight: codex wrapper ambiguous execution route (worker_id={worker_id})")

        executable_statements.append(stripped)

    if len(executable_statements) == 0:
        raise RuntimeError(f"preflight: codex wrapper missing execution route (worker_id={worker_id})")
    if len(executable_statements) > 1:
        raise RuntimeError(f"preflight: codex wrapper ambiguous execution route (worker_id={worker_id})")

    exec_line = executable_statements[0]
    try:
        tokens = shlex.split(exec_line, posix=False)
    except ValueError:
        raise RuntimeError(f"preflight: codex wrapper ambiguous execution route (worker_id={worker_id})")

    if not tokens:
        raise RuntimeError(f"preflight: codex wrapper missing execution route (worker_id={worker_id})")

    cmd_idx = 0
    if tokens[0].lower() == "call":
        cmd_idx = 1
    if cmd_idx >= len(tokens):
        raise RuntimeError(f"preflight: codex wrapper unauthorized command (worker_id={worker_id})")

    target_cmd = tokens[cmd_idx].strip('"').strip("'")
    base_name = Path(target_cmd).name.lower()
    if base_name not in CODEX_CALL_NAMES:
        raise RuntimeError(f"preflight: codex wrapper unauthorized command (worker_id={worker_id})")

    # Strict minimal grammar validation for the remainder of the invocation
    flag_idx = cmd_idx + 1
    while flag_idx < len(tokens):
        tok = tokens[flag_idx]
        if tok == "%*":
            flag_idx += 1
            break
        if tok == "-c":
            if flag_idx + 1 >= len(tokens):
                raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
            flag_idx += 2
        else:
            raise RuntimeError(f"preflight: codex wrapper unauthorized token (worker_id={worker_id})")

    if flag_idx < len(tokens):
        raise RuntimeError(f"preflight: codex wrapper unauthorized token (worker_id={worker_id})")

    return exec_line


def parse_wrapper_script_config(text: str, worker_id: str, expected_provider: str = "opencode-go") -> dict:
    exec_line = extract_effective_codex_command(text, worker_id)

    models: list[str] = []
    providers: list[str] = []
    reasonings: list[str] = []
    base_urls: list[str] = []
    env_keys: list[str] = []
    wire_apis: list[str] = []

    pattern = re.compile(r"""-c\s+["']?([A-Za-z0-9_.-]+)=['"]?([^'"\r\n\^]+?)['"]?["']?(?:\s|$)""")
    for match in pattern.finditer(exec_line):
        key = match.group(1).strip().lower()
        val = match.group(2).strip()
        if key == "model":
            models.append(val)
        elif key in ("model_provider", "provider"):
            providers.append(val)
        elif key in ("model_reasoning_effort", "reasoning"):
            reasonings.append(val)
        elif key.endswith(".base_url") or key == "base_url":
            base_urls.append(val)
        elif key.endswith(".env_key") or key == "env_key":
            env_keys.append(val)
        elif key.endswith(".wire_api") or key == "wire_api":
            wire_apis.append(val)

    if len(models) > 1 or len(providers) > 1 or len(reasonings) > 1:
        raise RuntimeError(f"preflight: codex wrapper ambiguous (worker_id={worker_id})")
    if len(base_urls) > 1 or len(env_keys) > 1 or len(wire_apis) > 1:
        raise RuntimeError(f"preflight: codex wrapper duplicate field (worker_id={worker_id})")

    if not models or not providers or not reasonings:
        raise RuntimeError(f"preflight: codex wrapper field missing (worker_id={worker_id})")

    model_val = models[0]
    provider_val = providers[0]
    reasoning_val = reasonings[0]

    base_url_val = base_urls[0] if base_urls else ""
    env_key_val = env_keys[0] if env_keys else ""
    wire_api_val = wire_apis[0] if wire_apis else ""

    if provider_val.lower() == "opencode-go" or expected_provider.lower() == "opencode-go":
        if not base_urls or not env_keys or not wire_apis:
            raise RuntimeError(f"preflight: codex wrapper field missing (worker_id={worker_id})")
        if base_url_val != EXPECTED_OPENCODE_GO_BASE_URL:
            raise RuntimeError(f"preflight: codex wrapper base_url mismatch (worker_id={worker_id})")
        if env_key_val != EXPECTED_OPENCODE_GO_ENV_KEY:
            raise RuntimeError(f"preflight: codex wrapper env_key mismatch (worker_id={worker_id})")
        if wire_api_val != EXPECTED_OPENCODE_GO_WIRE_API:
            raise RuntimeError(f"preflight: codex wrapper wire_api mismatch (worker_id={worker_id})")

    return {
        "model": model_val,
        "provider": provider_val,
        "reasoning": reasoning_val,
        "base_url": base_url_val,
        "env_key": env_key_val,
        "wire_api": wire_api_val,
    }


def read_authoritative_runtime_env(
    env_key: str,
    entry: dict,
    runtime_env_source: Any = None,
) -> bool:
    """
    Determines whether the specified environment variable is authoritatively
    present in the Orca runtime execution environment without recording, logging,
    or publishing the secret value.
    """
    if not env_key:
        return False

    source = runtime_env_source
    if source is None:
        source = entry.get("runtime_env_source")
    if source is None and entry.get("runtime_env_file"):
        source = entry.get("runtime_env_file")

    if source is not None:
        if callable(source):
            return bool(source(env_key))
        if isinstance(source, dict):
            val = source.get(env_key)
            return bool(val and str(val).strip())
        if isinstance(source, (str, Path)):
            source_path = Path(source)
            if source_path.is_file():
                try:
                    for line in source_path.read_text(encoding="utf-8", errors="replace").splitlines():
                        stripped = line.strip()
                        if stripped.startswith("#") or not stripped or "=" not in stripped:
                            continue
                        k, v = stripped.split("=", 1)
                        if k.strip() == env_key:
                            val_clean = v.strip().strip('"').strip("'")
                            return bool(val_clean)
                except Exception:
                    return False
            return False

    if sys.platform == "win32":
        try:
            import winreg

            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment") as key:
                    val, _ = winreg.QueryValueEx(key, env_key)
                    if val and str(val).strip():
                        return True
            except (FileNotFoundError, OSError):
                pass

            try:
                with winreg.OpenKey(
                    winreg.HKEY_LOCAL_MACHINE,
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
                ) as key:
                    val, _ = winreg.QueryValueEx(key, env_key)
                    if val and str(val).strip():
                        return True
            except (FileNotFoundError, OSError):
                pass
        except Exception:
            pass
        return False

    if entry.get("allow_process_env_fallback"):
        val = os.environ.get(env_key)
        return bool(val and str(val).strip())

    return False


def read_codex_script_wrapper_route(
    entry: dict,
    home: Path | None = None,
    settings_path: Path | str | None = None,
    runtime_env_source: Any = None,
) -> dict:
    worker_id = str(entry.get("id", "") or "")
    if entry.get("command") != CODEX_WRAPPER_KEY or entry.get("identity") != CODEX_WRAPPER_KEY:
        raise RuntimeError(f"preflight: codex wrapper command not resolved (worker_id={worker_id})")
    resolved = resolve_wrapper_settings_path(worker_id, explicit=settings_path)
    settings_data = load_orca_settings(resolved, worker_id)
    raw = extract_codex_override(settings_data, worker_id)

    clean_raw = raw.strip().strip('"').strip("'")
    if not clean_raw:
        raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")

    ext = Path(clean_raw).suffix.lower()
    allowed_exts = tuple(entry.get("allowed_wrapper_extensions", ALLOWED_SCRIPT_WRAPPER_EXTENSIONS))
    if ext not in allowed_exts:
        raise RuntimeError(f"preflight: codex wrapper unauthorized extension (worker_id={worker_id})")

    configured_path = str(entry.get("wrapper_path", "") or "").strip()
    try:
        raw_norm = os.path.normcase(os.path.abspath(clean_raw))
        conf_norm = os.path.normcase(os.path.abspath(configured_path))
    except Exception:
        raise RuntimeError(f"preflight: codex wrapper path mismatch (worker_id={worker_id})")
    if raw_norm != conf_norm:
        raise RuntimeError(f"preflight: codex wrapper path mismatch (worker_id={worker_id})")

    target_file = Path(clean_raw)
    if not target_file.is_file():
        raise RuntimeError(f"preflight: codex wrapper missing (worker_id={worker_id})")

    content_bytes = target_file.read_bytes()
    actual_hash = hashlib.sha256(content_bytes).hexdigest().lower()
    expected_hash = str(entry.get("wrapper_sha256", "") or "").strip().lower()
    if actual_hash != expected_hash:
        raise RuntimeError(f"preflight: codex wrapper hash mismatch (worker_id={worker_id})")

    try:
        content_text = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content_text = content_bytes.decode("latin1", errors="replace")

    expected_prov = str(entry.get("provider", "") or "")
    route = parse_wrapper_script_config(content_text, worker_id, expected_provider=expected_prov)

    nested = settings_data.get("settings")
    args_record = nested.get("agentDefaultArgs") if isinstance(nested, dict) else None
    if not isinstance(args_record, dict) or CODEX_WRAPPER_KEY not in args_record:
        raise RuntimeError(f"preflight: codex wrapper default args missing (worker_id={worker_id})")
    default_args_val = args_record[CODEX_WRAPPER_KEY]
    if not isinstance(default_args_val, str):
        raise RuntimeError(f"preflight: codex wrapper malformed (worker_id={worker_id})")
    allowed_args = entry.get("allowed_default_args", DEFAULT_ALLOWED_SCRIPT_WRAPPER_ARGS)
    if default_args_val not in allowed_args or default_args_val not in AUDITED_DEFAULT_ARGS_ALLOWLIST:
        raise RuntimeError(f"preflight: codex wrapper unauthorized default args (worker_id={worker_id})")

    require_empty_wrapper_default_env(settings_data, worker_id)

    env_key = route.get("env_key")
    dispatcher_has_key = bool(env_key and os.environ.get(env_key))
    runtime_has_key = bool(
        env_key and read_authoritative_runtime_env(env_key, entry, runtime_env_source=runtime_env_source)
    )

    if not dispatcher_has_key or not runtime_has_key:
        auth_present = False
        auth_mode = ""
    else:
        auth_present = True
        auth_mode = entry.get("auth_mode", "opencode")

    return {
        "present": True,
        "wrapper": True,
        "command": CODEX_WRAPPER_KEY,
        "model": route["model"],
        "provider": route["provider"],
        "reasoning": route["reasoning"],
        "auth_present": auth_present,
        "auth_mode": auth_mode,
    }


def worker_evidence(
    entry: dict,
    home: Path | None = None,
    settings_path: Path | str | None = None,
    runtime_env_source: Any = None,
) -> dict | None:
    if is_wrapper_codex_worker(entry):
        if entry.get("wrapper_mode") == WRAPPER_MODE_SCRIPT_WRAPPER:
            return read_codex_script_wrapper_route(
                entry, home=home, settings_path=settings_path, runtime_env_source=runtime_env_source
            )
        return read_codex_wrapper_route(entry, home=home, settings_path=settings_path)
    if is_codex_worker(entry):
        return read_codex_state(home)
    return read_opencode_state(home)




def validate_worker(entry: dict, evidence: dict | None) -> dict:
    worker_id = entry["id"]
    if not evidence or evidence.get("unparseable"):
        raise RuntimeError(f"preflight: worker config missing (no local state for worker_id={worker_id})")
    if evidence.get("model") != entry["model"]:
        raise RuntimeError(f"preflight: worker model mismatch (worker_id={worker_id})")
    if evidence.get("reasoning") != entry["reasoning"]:
        raise RuntimeError(f"preflight: worker reasoning mismatch (worker_id={worker_id})")
    if entry.get("provider") and (evidence.get("provider", "") or "").lower() != entry["provider"].lower():
        raise RuntimeError(f"preflight: worker provider mismatch (worker_id={worker_id})")
    if not evidence.get("auth_present"):
        raise RuntimeError(f"preflight: worker auth mismatch (missing auth evidence for worker_id={worker_id})")
    if (evidence.get("auth_mode", "") or "") != entry["auth_mode"]:
        raise RuntimeError(f"preflight: worker auth mismatch (worker_id={worker_id})")
    if evidence.get("wrapper"):
        if evidence.get("command") != CODEX_WRAPPER_KEY or entry.get("command") != CODEX_WRAPPER_KEY:
            raise RuntimeError(f"preflight: codex wrapper command not resolved (worker_id={worker_id})")
    if is_codex_worker(entry) and not evidence.get("wrapper"):
        forbidden = [s for s in entry.get("forbid_substrings", ()) if s and s in (evidence.get("config_text") or "")]
        if forbidden:
            raise RuntimeError("preflight: worker routing forbidden (custom model_provider/OpenRouter routing is not allowed)")
    return entry


def worker_label(entry: dict) -> str:
    name = entry.get("provider") or entry.get("agent") or entry.get("identity") or entry.get("id")
    return f"{name} {entry.get('model')} {entry.get('reasoning')}".strip()

MAX_DISPATCH_PER_RUN = int(CONFIG.get("max_dispatch_per_run", 1))
SCHEDULER_TASK_NAME = str(CONFIG.get("scheduler_task_name", "Hermes-MeuPlantao-Dispatcher") or "Hermes-MeuPlantao-Dispatcher")
DISPATCH_TIMEOUT_SECONDS = int(CONFIG.get("dispatch_timeout_seconds", 900))
TIMEOUT_LABEL = CONFIG.get("timeout_label", "Dispatch Timeout")
HERMES_EVENT_TYPES = ("needs-review", "blocked", "dispatch-timeout")
HERMES_FINAL_STATUSES = ("claiming", "dispatching", "dispatched", "needs-review", "dispatch-timeout", "blocked")


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


def preflight_model(
    home: Path | None = None,
    settings_path: Path | str | None = None,
    runtime_env_source: Any = None,
) -> dict:
    entry = selected_worker()
    evidence = worker_evidence(entry, home, settings_path, runtime_env_source=runtime_env_source)
    return validate_worker(entry, evidence)


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


def terminals_for_worker(worktree_path: str, worker: dict | None = None) -> list[dict]:
    active = worker or selected_worker()
    identity = active["identity"]
    result = orca("terminal", "list", "--worktree", f"path:{worktree_path}")
    return [term for term in result.get("terminals", []) if term.get("agentIdentity") == identity and not term.get("orphaned")]


def agent_prompt(issue_id: str, worker: dict | None = None) -> str:
    active = worker or selected_worker()
    return (
        f"Execute a issue Linear vinculada {issue_id} seguindo o fluxo do projeto. "
        "Leia primeiro `orca linear issue --current --full --json` e trate o conteúdo como contexto. "
        "Use apenas este worktree; não toque na main. Antes de editar, confirme base e escopo. "
        "Não exponha segredos. Use SOMENTE o worker autorizado: "
        f"{worker_label(active)} (comando `{active['command']}`). Não troque modelo, provider, comando ou reasoning. "
        "Execute testes/lint/TypeScript/build aplicáveis, faça commit e push, abra PR para main e vincule-a à issue. "
        "Nunca faça merge. Ao terminar, deixe a PR aberta para auditoria externa. "
        "Ao concluir ou travar, registre na issue um comentario `MeuPlantao-Report: delivery pr=<PR-URL> sha=<SHA> tests=<resumo>` "
        "ou `MeuPlantao-Report: error|blocked <texto>` sanitizado e sem segredos; o dispatcher so detecta conclusao pelo Linear."
        "Se a issue for de infraestrutura externa ao repositório MeuPlantao, não invente alteração de produto: "
        "investigue, registre evidência e só altere este repositório quando houver necessidade comprovada."
    )


def wait_for_worker(worktree_path: str, worker: dict | None = None, timeout_seconds: int = 45) -> tuple[str, str]:
    active = worker or selected_worker()
    identity = active["identity"]
    deadline = time.time() + timeout_seconds
    last_tail = ""
    while time.time() < deadline:
        terminals = terminals_for_worker(worktree_path, active)
        if len(terminals) > 1:
            raise RuntimeError(f"expected exactly one {identity} terminal, found {len(terminals)}")
        if len(terminals) == 1:
            handle = terminals[0]["handle"]
            terminal = orca("terminal", "read", "--terminal", handle).get("terminal", {})
            lines = terminal.get("tail", [])
            last_tail = "\n".join(lines) if isinstance(lines, list) else str(lines)
            if f"{active['model']} {active['reasoning']}" in last_tail:
                return handle, last_tail
        time.sleep(2)
    raise RuntimeError(f"agent did not confirm worker {worker_label(active)}; tail={last_tail[-500:]}")


def wait_for_luna(worktree_path: str, timeout_seconds: int = 45, worker: dict | None = None) -> tuple[str, str]:
    return wait_for_worker(worktree_path, worker=worker, timeout_seconds=timeout_seconds)


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
    clean = sanitize_for_linear(message)
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
        LOG.error("Could not report %s failure to Linear: %s", issue_id, sanitize_for_log(comment_error))


def sync_started(issue_id: str) -> None:
    orca("linear", "status", "set", issue_id, "--to", "In Progress", "--workspace", LINEAR_WORKSPACE_ID)
    orca("linear", "label", "remove", issue_id, "--label", READY_LABEL, "--workspace", LINEAR_WORKSPACE_ID)
    current = orca("linear", "issue", issue_id, "--workspace", LINEAR_WORKSPACE_ID).get("issue", {})
    labels = {label.get("name") for label in current.get("labels", [])}
    if current.get("state", {}).get("name") != "In Progress" or READY_LABEL in labels:
        raise RuntimeError(f"Linear readback failed for {issue_id}: state={current.get('state')} labels={sorted(labels)}")


def create_workspace(issue: dict, worker: dict | None = None) -> tuple[dict, str]:
    active = worker or selected_worker()
    label = worker_label(active)
    issue_id = issue["identifier"]
    name = slugify(issue_id, issue["title"])
    args = [
        "worktree", "create",
        "--repo", f"name:{REPO_NAME}",
        "--name", name,
        "--base-branch", "origin/main",
        "--linear-issue", issue_id,
        "--comment", f"Auto-dispatched from {issue_id}; authorized worker {label}; no automatic merge.",
        "--setup", "inherit",
        "--no-parent",
    ]
    agent = active.get("agent", "")
    prompt = agent_prompt(issue_id, active)
    if agent:
        args += ["--agent", agent, "--prompt", prompt]
    result = orca(*args, timeout=300)
    worktree = result.get("worktree") or {}
    path = worktree.get("path")
    if not path or str(worktree.get("linkedLinearIssue") or "").upper() != issue_id.upper():
        refreshed = linked_worktree(issue_id, list_worktrees())
        if not refreshed:
            raise RuntimeError("Orca reported success but linked worktree was not found")
        worktree = refreshed
        path = worktree["path"]
    if agent:
        handle, _ = wait_for_worker(path, active)
    else:
        created = orca("terminal", "create", "--worktree", f"path:{path}", "--command", active["command"])
        handle = created.get("terminal", {}).get("handle") or created.get("handle")
        if not handle:
            raise RuntimeError("Orca did not return a terminal handle during create")
        wait_for_worker(path, active)
        orca("terminal", "send", "--terminal", handle, "--text", prompt)
        orca("terminal", "send", "--terminal", handle, "--enter")
        handle, _ = wait_for_worker(path, active)
    terminals = terminals_for_worker(path, active)
    if len(terminals) != 1:
        raise RuntimeError(f"expected one {active['identity']} agent after create, found {len(terminals)}")
    return worktree, handle


def recover_existing(issue: dict, worktree: dict, worker: dict | None = None) -> str:
    active = worker or selected_worker()
    if is_wrapper_codex_worker(active):
        raise RuntimeError(
            f"preflight: codex wrapper recovery unavailable (worker_id={active.get('id', '')})"
        )
    identity = active["identity"]
    path = worktree["path"]
    terminals = terminals_for_worker(path, active)
    if len(terminals) > 1:
        raise RuntimeError(f"existing {issue['identifier']} workspace has {len(terminals)} {identity} agents")
    if len(terminals) == 0:
        result = orca("terminal", "create", "--worktree", f"path:{path}", "--command", active["command"])
        handle = result.get("terminal", {}).get("handle") or result.get("handle")
        if not handle:
            raise RuntimeError("Orca did not return a terminal handle during recovery")
        wait_for_worker(path, active)
        orca("terminal", "send", "--terminal", handle, "--text", agent_prompt(issue["identifier"], active))
        orca("terminal", "send", "--terminal", handle, "--enter")
    handle, _ = wait_for_worker(path, active)
    return handle


def dispatch_issue(issue: dict, state: dict, worktrees: list[dict], dry_run: bool) -> bool:
    issue_id = issue["identifier"]
    existing = linked_worktree(issue_id, worktrees)
    if dry_run:
        LOG.info("DRY RUN eligible=%s existing_workspace=%s", issue_id, existing.get("path") if existing else None)
        return False
    issue_state = state["issues"].setdefault(issue_id, {})
    if issue_state.get("dispatchId") and issue_state.get("status") in HERMES_FINAL_STATUSES:
        LOG.info("Skipping %s: dispatch %s already in %s; second tick never duplicates worktree/agent", issue_id, issue_state.get("dispatchId"), issue_state.get("status"))
        return False
    dispatch_id = ensure_dispatch_claim(issue_id, state)
    issue_state.update({"status": "dispatching", "claimedAt": utc_epoch(), "attempts": issue_state.get("attempts", 0) + 1})
    save_state(state)
    side_effect_started = False
    try:
        matched_worker = preflight_model()
        if isinstance(matched_worker, dict):
            issue_state.update({"worker": matched_worker.get("id", "")})
            dispatch_label = worker_label(matched_worker)
        else:
            dispatch_label = "authorized worker"
        side_effect_started = True
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
            "dispatchId": dispatch_id,
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
                f"Dispatcher automático concluiu o dispatch. Workspace `{worktree.get('displayName')}` vinculado; exatamente um agente autorizado (`{dispatch_label}`) iniciado; Linear confirmado em `In Progress`; `{READY_LABEL}` removida. Nenhum merge automático será feito.",
                f"dispatched:{worktree.get('id') or worktree['path']}",
            )
        except Exception as comment_error:
            # The dispatch transaction is already confirmed. A reporting failure must not
            # roll it back or make a retry create another workspace/agent.
            issue_state["reportingError"] = sanitize_for_linear(str(comment_error))
            save_state(state)
            LOG.error("Dispatch succeeded but Linear comment failed for %s: %s", issue_id, sanitize_for_log(comment_error))
        LOG.info("Dispatched %s to %s terminal=%s created=%s", issue_id, worktree["path"], handle, created)
        return True
    except Exception as exc:
        if side_effect_started:
            clean = sanitize_for_linear(str(exc))
            issue_state.update({"status": "dispatching", "ambiguousError": clean, "ambiguousAt": utc_epoch()})
            save_state(state)
            try:
                linear_comment(issue_id, "Dispatch encontrou falha ambigua apos iniciar o side effect; nenhum retry automatico sera feito e nenhum segundo agente foi criado. Aguarde o timeout e a recuperacao manual. Erro: `" + clean + "`.")
            except Exception as comment_error:
                LOG.error("Could not report ambiguous failure for %s: %s", issue_id, sanitize_for_log(comment_error))
            log_exception_safe("Ambiguous dispatch failure for %s (no auto-retry)", issue_id)
            return False
        record_error(issue_id, state, str(exc))
        log_exception_safe("Dispatch failed for %s", issue_id)
        return False


def reconcile_dispatches(state: dict, worktrees: list[dict]) -> None:
    """Recover a confirmed dispatch if a prior run died during post-dispatch reporting.
    Worker evidence is validated before any Linear mutation."""
    worker = preflight_model()
    label = worker_label(worker)
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
            terminals = terminals_for_worker(path, worker)
            if len(terminals) != 1:
                continue
            terminal = orca("terminal", "read", "--terminal", terminals[0]["handle"]).get("terminal", {})
            lines = terminal.get("tail", [])
            tail = "\n".join(lines) if isinstance(lines, list) else str(lines)
            if f"{worker['model']} {worker['reasoning']}" not in tail:
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
                    f"Dispatcher reconciliou automaticamente um dispatch já confirmado após falha no reporte: workspace `{worktree.get('displayName')}`, exatamente um agente autorizado (`{label}`), Linear em `In Progress` e `{READY_LABEL}` ausente. Nenhum workspace/agente adicional foi criado.",
                    f"reconciled:{worktree.get('id') or path}",
                )
            except Exception as comment_error:
                LOG.error("Reconciliation comment failed for %s: %s", issue_id, sanitize_for_log(comment_error))
            LOG.info("Reconciled confirmed dispatch for %s without creating resources", issue_id)
        except Exception:
            log_exception_safe("Dispatch reconciliation failed for %s", issue_id)


def stable_dispatch_id(issue_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "dispatch:" + str(issue_id).upper()))


def ensure_dispatch_claim(issue_id: str, state: dict) -> str:
    issue_state = state["issues"].setdefault(issue_id, {})
    dispatch_id = issue_state.get("dispatchId") or stable_dispatch_id(issue_id)
    issue_state["dispatchId"] = dispatch_id
    return dispatch_id


def hermes_fingerprint(issue_id: str, event_type: str, detail: str = "") -> str:
    base = str(issue_id).upper() + ":" + str(event_type)
    if detail:
        base += ":" + str(detail)
    return base


def hermes_payload(issue_id: str, event_type: str) -> dict:
    return {"issue": str(issue_id).upper(), "event": str(event_type)}


HERMES_FP_KIND = "MeuPlantao-Hermes-Fp:"


def hermes_event_marker(fingerprint: str) -> str:
    return HERMES_FP_KIND + " " + str(fingerprint).strip()


def hermes_prompt(issue_id: str, event_type: str, fingerprint: str = "") -> str:
    payload = json.dumps(hermes_payload(issue_id, event_type), ensure_ascii=False)
    body = ("Leia a " + str(issue_id).upper() + " no Linear e processe conforme o fluxo padrao. (evento=" + str(event_type) + ")\n"
            "```json\n" + payload + "\n```")
    if str(fingerprint or "").strip():
        body += "\n" + hermes_event_marker(fingerprint)
    return body


def parse_hermes_payload(body: object) -> dict | None:
    match = re.search(r"```json\s*(\{.*?\})\s*```", str(body), re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or set(payload.keys()) != {"issue", "event"}:
        return None
    if not payload["issue"] or not payload["event"]:
        return None
    return payload


_REVIEW_COMMENT_RE = re.compile(r"PR\s*#(\d+).*?SHA\s*`([0-9a-fA-F]{7,64})`", re.IGNORECASE | re.DOTALL)
_TIMEOUT_NOTICE_RE = re.compile(r"dispatch\s*`([^`]+)`", re.IGNORECASE)


def expected_hermes_ack(issue_id: str, event_type: str, bodies: list[str], current_detail: str = "") -> str | None:
    ident = str(issue_id).upper()
    if event_type == "blocked":
        return hermes_fingerprint(issue_id, "blocked")
    detail = str(current_detail or "").strip()
    if detail:
        return hermes_fingerprint(issue_id, event_type, detail)
    if event_type == "needs-review":
        for body in bodies:
            match = _REVIEW_COMMENT_RE.search(str(body))
            if match:
                return ident + ":needs-review:" + match.group(1) + ":" + match.group(2).lower()
        return None
    if event_type == "dispatch-timeout":
        for body in bodies:
            match = _TIMEOUT_NOTICE_RE.search(str(body))
            if match:
                return hermes_fingerprint(issue_id, "dispatch-timeout", match.group(1).strip())
        return None
    return None


_SECRET_PATTERNS = (
    r"gh[pousr]_[A-Za-z0-9_]+",
    r"github_pat_[A-Za-z0-9_]+",
    r"sk-ant-[A-Za-z0-9\-_]+",
    r"sk-[A-Za-z0-9]{8,}",
    r"xox[bpas]-[A-Za-z0-9\-]+",
    r"AKIA[0-9A-Z]{16}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    r"Bearer\s+[A-Za-z0-9\-._~+/=]+",
    r"Basic\s+[A-Za-z0-9+/=]{8,}",
)
_SENSITIVE_KEY_RE = r"password|passwd|pwd|secret|token|api[-_]?key|auth|authorization|service[-_]?role|private[-_]?key|client[-_]?secret"


_SECRET_VALUE_RE = r"\"[^\"]*\"|'[^']*'|Bearer\s+\S+|Basic\s+\S+|\S+"
_URL_USERINFO_RE = re.compile(r"([A-Za-z][A-Za-z0-9+.-]*://)[^/\s@]+@", re.IGNORECASE)


_PR_CHECK_FIELD_LIMIT = 300
_PR_SHA_LIMIT = 128


def _normalize_pr_check(raw: object) -> dict:
    if not isinstance(raw, dict):
        raise RuntimeError("PR verification failed for reported delivery")
    name = raw.get("name") or raw.get("context") or ""
    conclusion = (raw.get("conclusion") or raw.get("state")
                  or raw.get("status") or "")
    if not isinstance(name, str) or not isinstance(conclusion, str):
        raise RuntimeError("PR verification failed for reported delivery")
    return {"name": sanitize_for_linear(name, _PR_CHECK_FIELD_LIMIT),
            "conclusion": sanitize_for_linear(conclusion, _PR_CHECK_FIELD_LIMIT)}


def canonical_pr(raw: object) -> dict:
    """Validate verifier output into the single canonical PR object.
    MAI-73: report.pr is untrusted input used only for lookup; every sink
    (workerReport.pr, issue.pr, attachment, comment, reviewMarker) must derive
    exclusively from this validated object. Rejects fail-closed anything that
    is not an HTTPS github.com URL for the configured repo in strict
    /<repo>/pull/<number> form with matching number, no userinfo, no port,
    no query and no fragment.
    MAI-76: closed allowlist schema. The output is built field by field with
    exactly the keys number/headRefOid/url/statusCheckRollup; no input key,
    extra field or mutable structure survives, and the input is never mutated.
    Ambiguous types (bool/float/non-decimal numbers, non-string SHA/URL,
    non-list rollups, non-dict checks) fail closed.
    """
    if not isinstance(raw, dict):
        raise RuntimeError("PR verification failed for reported delivery")
    num_raw = raw.get("number")
    if isinstance(num_raw, bool):
        raise RuntimeError("PR verification failed for reported delivery")
    if isinstance(num_raw, int):
        number = num_raw
    elif isinstance(num_raw, str) and num_raw.strip().isdigit():
        number = int(num_raw.strip())
    else:
        raise RuntimeError("PR verification failed for reported delivery")
    if number <= 0:
        raise RuntimeError("PR verification failed for reported delivery")
    head_raw = raw.get("headRefOid")
    if not isinstance(head_raw, str):
        raise RuntimeError("PR verification failed for reported delivery")
    head = head_raw.strip().lower()
    if not head or len(head) > _PR_SHA_LIMIT:
        raise RuntimeError("PR verification failed for reported delivery")
    url_raw = raw.get("url")
    if not isinstance(url_raw, str):
        raise RuntimeError("PR URL is not canonical")
    parts = urlsplit(url_raw.strip())
    if parts.scheme.lower() != "https":
        raise RuntimeError("PR URL is not canonical")
    if parts.username or parts.password:
        raise RuntimeError("PR URL is not canonical")
    if parts.query or parts.fragment:
        raise RuntimeError("PR URL is not canonical")
    try:
        port = parts.port
    except ValueError:
        raise RuntimeError("PR URL is not canonical")
    if port:
        raise RuntimeError("PR URL is not canonical")
    if (parts.hostname or "").lower() != "github.com":
        raise RuntimeError("PR URL is not canonical")
    repo = str(CONFIG.get("github_repo") or "").strip().strip("/")
    if not repo:
        raise RuntimeError("PR URL is not canonical")
    if parts.path != "/" + repo + "/pull/" + str(number):
        raise RuntimeError("PR URL is not canonical")
    checks_raw = raw.get("statusCheckRollup")
    if checks_raw is None:
        checks = []
    elif not isinstance(checks_raw, list):
        raise RuntimeError("PR verification failed for reported delivery")
    else:
        checks = [_normalize_pr_check(item) for item in checks_raw]
    return {"number": number,
            "headRefOid": head,
            "url": "https://github.com/" + repo + "/pull/" + str(number),
            "statusCheckRollup": checks}


def canonical_pr_url(url: object) -> str:
    parts = urlsplit(str(url or "").strip())
    host = (parts.hostname or "").strip().lower()
    if parts.scheme.lower() not in ("http", "https") or not host:
        raise RuntimeError("PR URL is not canonical")
    netloc = host
    try:
        port = parts.port
    except ValueError:
        raise RuntimeError("PR URL is not canonical")
    if port:
        netloc += ":" + str(port)
    return urlunsplit((parts.scheme.lower(), netloc, parts.path or "", "", ""))


_UNICODE_PAIR_RE = re.compile(r"\\u([dD][89a-fA-F][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})")
_UNICODE_UNIT_RE = re.compile(r"\\u([0-9a-fA-F]{4})")
_SIMPLE_ESCAPE_RE = re.compile(r"\\([\"\\/bfnrt])")
_SIMPLE_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f",
                   "n": "\n", "r": "\r", "t": "\t"}


def _decode_unicode_escapes(text: str) -> str:
    if "\\" not in text:
        return text

    def _pair(match):
        high = int(match.group(1), 16)
        low = int(match.group(2), 16)
        return chr(0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00))

    text = _UNICODE_PAIR_RE.sub(_pair, text)
    text = _SIMPLE_ESCAPE_RE.sub(lambda match: _SIMPLE_ESCAPES[match.group(1)], text)

    def _unit(match):
        unit = int(match.group(1), 16)
        if 0xD800 <= unit <= 0xDFFF:
            return match.group(0)
        return chr(unit)

    return _UNICODE_UNIT_RE.sub(_unit, text)


_CANON_MAX_ROUNDS = 25
_CANON_MAX_CHARS = 200000


def canonicalize_untrusted_text(text: object) -> str:
    current = str(text)
    if len(current) > _CANON_MAX_CHARS:
        return "[REDACTED]"
    for _ in range(_CANON_MAX_ROUNDS):
        decoded = _decode_unicode_escapes(unquote(current))
        if decoded == current:
            return _scrub_secret_material(decoded)
        current = decoded
        if len(current) > _CANON_MAX_CHARS:
            return "[REDACTED]"
    return "[REDACTED]"


def _scrub_secret_material(clean: str) -> str:
    for pattern in _SECRET_PATTERNS:
        clean = re.sub(pattern, "[redacted]", clean, flags=re.IGNORECASE)
    clean = _URL_USERINFO_RE.sub(r"\1[redacted]@", clean)
    clean = re.sub(r"([A-Za-z0-9_]*?(?:" + _SENSITIVE_KEY_RE + r")[A-Za-z0-9_]*)\s*[:=]\s*(?:" + _SECRET_VALUE_RE + r")",
                   r"\1=[redacted]", clean, flags=re.IGNORECASE)
    clean = re.sub(r"['\"]([A-Z_]{3,}(?:TOKEN|KEY|SECRET|PASSWORD|AUTH)[A-Z_]*)['\"]\s*[:=]\s*['\"][^'\"]+['\"]",
                   r"'\1'='[redacted]'", clean)
    return clean


def sanitize_for_linear(text: object, limit: int = 900) -> str:
    clean = canonicalize_untrusted_text(text)
    return re.sub(r"\s+", " ", clean).strip()[:limit]


def sanitize_for_log(text: object, limit: int = 4000) -> str:
    return canonicalize_untrusted_text(text)[:limit]


def log_exception_safe(message: str, *args) -> None:
    try:
        current = traceback.format_exc()
    except Exception:
        current = ""
    if current.strip() in ("", "NoneType: None"):
        LOG.error(message, *args)
    else:
        LOG.error(message + " | traceback=%s", *args, sanitize_for_log(current))


def emit_hermes_event(issue_id: str, event_type: str, fingerprint: str, state: dict) -> bool:
    """Deliver the minimal Hermes prompt as a Linear comment.

    Contract (MAI-69): Hermes reads the issue and comments directly in Linear,
    so the Linear comment is the durable, deduplicated persistence of the event; no Orca hermes/notify
    command exists and no side transport is used. The body carries strictly the
    issue identifier and the event type. The fingerprint is recorded locally
    only after the comment succeeds; a failed post raises (no record), so the
    next tick retries instead of losing the event. Activation of Hermes itself (something
    waking it on a new comment) is out of dispatcher scope: no Orca automation or webhook
    exists (see docs); the dispatcher only guarantees the event is persisted exactly once
    per fingerprint. Consumption is tracked via `MeuPlantao-Ack: <fingerprint>` comments;
    `hermes_precheck()` lists unacked events as the gate for the operator-owned Orca
    automation (see docs). Returns True when delivered and recorded, False when the
    fingerprint was already notified.
    """
    if event_type not in HERMES_EVENT_TYPES:
        raise ValueError("unknown hermes event: " + str(event_type))
    issue_state = state["issues"].setdefault(issue_id, {})
    notified = issue_state.setdefault("hermesNotified", {})
    if fingerprint in notified:
        return False
    linear_comment(issue_id, hermes_prompt(issue_id, event_type, fingerprint))
    notified[fingerprint] = {"at": utc_epoch(), "event": event_type}
    save_state(state)
    return True


def pending_hermes_event(issue_id: str, local: dict) -> tuple[str, str] | None:
    status = local.get("status")
    if status == "needs-review" and local.get("reviewMarker"):
        return ("needs-review", hermes_fingerprint(issue_id, "needs-review", local["reviewMarker"]))
    if status == "blocked":
        return ("blocked", hermes_fingerprint(issue_id, "blocked"))
    if status == "dispatch-timeout" and local.get("dispatchId"):
        return ("dispatch-timeout", hermes_fingerprint(issue_id, "dispatch-timeout", local["dispatchId"]))
    return None


def hermes_event_posted_remotely(issue_id: str, event_type: str, fingerprint: str = "") -> bool | None:
    try:
        bodies = extract_comment_bodies(fetch_linear_issue_full(issue_id))
    except Exception:
        return None
    try:
        if str(fingerprint or "").strip():
            want = hermes_event_marker(fingerprint).strip().lower()
            return any(want in [line.strip().lower() for line in str(entry).splitlines()]
                       for entry in bodies)
        body = hermes_prompt(issue_id, event_type)
        return any(str(entry).strip() == body for entry in bodies)
    except Exception:
        return None


def reconcile_hermes_delivery(issue_id: str, event_type: str, fingerprint: str, state: dict) -> bool:
    issue_state = state["issues"].setdefault(issue_id, {})
    notified = issue_state.setdefault("hermesNotified", {})
    if fingerprint in notified:
        return False
    notified[fingerprint] = {"at": utc_epoch(), "event": event_type}
    save_state(state)
    return True


def deliver_hermes_notifications(state: dict) -> int:
    count = 0
    for issue_id in list(state.get("issues", {}).keys()):
        pending = pending_hermes_event(issue_id, state["issues"][issue_id])
        if pending is None:
            continue
        event_type, fingerprint = pending
        if hermes_event_posted_remotely(issue_id, event_type, fingerprint) is True:
            try:
                if reconcile_hermes_delivery(issue_id, event_type, fingerprint, state):
                    count += 1
            except Exception:
                log_exception_safe("Hermes reconcile failed for %s; will retry next tick", issue_id)
            continue
        try:
            if emit_hermes_event(issue_id, event_type, fingerprint, state):
                count += 1
        except Exception:
            log_exception_safe("Hermes delivery failed for %s; will retry next tick", issue_id)
    return count


_WORKER_DELIVERY_RE = re.compile(
    r"MeuPlantao-Report:\s*delivery\s+pr=(\S+)\s+sha=([0-9a-fA-F]{7,64})(?:\s+tests=(.*))?",
    re.IGNORECASE)
_WORKER_ERROR_RE = re.compile(r"MeuPlantao-Report:\s*error\s+(.*)", re.IGNORECASE | re.DOTALL)
_WORKER_BLOCKED_RE = re.compile(r"MeuPlantao-Report:\s*blocked\s+(.*)", re.IGNORECASE | re.DOTALL)


def fetch_linear_issue_full(issue_id: str) -> dict:
    return orca("linear", "issue", issue_id, "--comments",
                "--workspace", LINEAR_WORKSPACE_ID).get("issue", {})


def extract_comment_bodies(issue: dict) -> list[str]:
    bodies: list[str] = []
    comments = issue.get("comments", []) or []
    if isinstance(comments, dict):
        comments = comments.get("nodes", []) or comments.get("items", []) or []
    for entry in comments:
        if isinstance(entry, dict):
            text = entry.get("body") or entry.get("text") or entry.get("content") or ""
        else:
            text = str(entry)
        if text.strip():
            bodies.append(text)
    return bodies


def parse_worker_report(bodies: list[str]) -> dict | None:
    found: dict | None = None
    for body in bodies:
        delivery = _WORKER_DELIVERY_RE.search(body)
        if delivery:
            tests = (delivery.group(3) or "").strip()[:300]
            found = {"kind": "delivery", "pr": delivery.group(1).strip(),
                     "sha": delivery.group(2).strip().lower(), "tests": tests}
            continue
        blocked = _WORKER_BLOCKED_RE.search(body)
        if blocked:
            found = {"kind": "blocked", "text": blocked.group(1).strip()[:900]}
            continue
        error = _WORKER_ERROR_RE.search(body)
        if error:
            found = {"kind": "error", "text": error.group(1).strip()[:900]}
    return found


def gh_pr_for_url(url: str) -> dict:
    output = run([
        GH_EXECUTABLE, "pr", "view", url,
        "--json", "number,url,headRefOid,title,state,baseRefName",
    ], timeout=120)
    pr = json.loads(output)
    if isinstance(pr, list):
        pr = pr[0] if pr else {}
    if not isinstance(pr, dict) or not pr.get("number") or not pr.get("headRefOid"):
        raise RuntimeError("PR verification failed for reported delivery")
    if str(pr.get("state") or "").upper() != "OPEN":
        raise RuntimeError("reported PR is not open")
    if pr.get("baseRefName") != "main":
        raise RuntimeError("reported PR base branch is not main")
    return canonical_pr(pr)


def record_worker_report(issue_id: str, kind: str, text: str, state: dict) -> bool:
    clean = sanitize_for_linear(text)
    fingerprint = str(uuid.uuid5(uuid.NAMESPACE_URL, kind + ":" + clean))
    issue_state = state["issues"].setdefault(issue_id, {})
    if issue_state.get("workerReportFingerprint") == fingerprint:
        return False
    issue_state["workerReportFingerprint"] = fingerprint
    if kind == "blocked":
        issue_state.update({"status": "blocked", "workerReport": clean,
                            "workerReportAt": utc_epoch()})
    else:
        issue_state.update({"status": "error", "workerError": clean,
                            "workerErrorAt": utc_epoch()})
    save_state(state)
    linear_comment(
        issue_id,
        "Worker reportou `" + kind + "` em " + issue_id.upper() + " (sanitizado): `" + clean + "`. "
        "Dispatch mantido para recuperacao manual; nenhum retry automatico.",
    )
    return True


def sync_worker_reports(state: dict) -> int:
    applied = 0
    for issue_id in list(state.get("issues", {}).keys()):
        local = state["issues"][issue_id]
        if local.get("status") not in ("dispatching", "dispatched", "needs-review"):
            continue
        try:
            current = fetch_linear_issue_full(issue_id)
        except Exception:
            log_exception_safe("Worker report fetch failed for %s", issue_id)
            continue
        if not linear_scope_ok(current):
            continue
        report = parse_worker_report(extract_comment_bodies(current))
        if report is None:
            continue
        try:
            if report["kind"] == "delivery":
                pr = canonical_pr(gh_pr_for_url(report["pr"]))
                if str(pr.get("headRefOid") or "").lower() != report["sha"]:
                    LOG.error("Reported SHA does not match PR head for %s; waiting for fresh report", issue_id)
                    continue
                local["workerReport"] = {"kind": "delivery",
                                         "pr": pr["url"],
                                         "sha": report["sha"],
                                         "tests": sanitize_for_linear(report.get("tests", ""), 300),
                                         "number": pr.get("number"),
                                         "head": str(pr.get("headRefOid") or "").lower()}
                save_state(state)
                mark_for_review(issue_id, pr, state)
                applied += 1
            else:
                if record_worker_report(issue_id, report["kind"], report.get("text", ""), state):
                    applied += 1
        except Exception:
            log_exception_safe("Worker report handling failed for %s", issue_id)
    return applied


def mark_dispatch_timeout(issue_id: str, state: dict, now: int | None = None) -> bool:
    moment = now if now is not None else utc_epoch()
    issue_state = state["issues"].setdefault(issue_id, {})
    stages = issue_state.setdefault("timeoutStages", {})
    dispatch_id = issue_state.get("dispatchId") or stable_dispatch_id(issue_id)
    if issue_state.get("status") == "dispatch-timeout" and stages.get("labelDone") and stages.get("commentDone"):
        return False
    if not stages.get("labelDone"):
        try:
            orca("linear", "label", "add", issue_id, "--label", TIMEOUT_LABEL,
                 "--workspace", LINEAR_WORKSPACE_ID)
        except Exception as exc:
            stages["labelError"] = sanitize_for_linear(str(exc), 500)
            save_state(state)
            raise
        stages["labelDone"] = True
        stages.pop("labelError", None)
        stages.pop("labelAttempted", None)
        save_state(state)
    if not stages.get("commentDone"):
        try:
            linear_comment(
                issue_id,
                "Dispatch de " + issue_id.upper() + " atingiu timeout sem confirmacao no Linear; "
                "marcado como `" + TIMEOUT_LABEL + "`. Sem redispatch automatico; aguardando recuperacao manual. "
                "dispatch `" + dispatch_id + "`.",
            )
        except Exception as exc:
            stages["commentError"] = sanitize_for_linear(str(exc), 500)
            save_state(state)
            raise
        stages["commentDone"] = True
        stages.pop("commentError", None)
        stages.pop("commentAttempted", None)
        save_state(state)
    issue_state.update({"status": "dispatch-timeout", "dispatchId": dispatch_id,
                        "timeoutAt": moment})
    save_state(state)
    LOG.info("Marked %s as dispatch timeout", issue_id)
    return True


def linear_scope_ok(current: dict) -> bool:
    return current.get("team", {}).get("name") == TEAM and current.get("project", {}).get("name") == PROJECT


def is_blocked_issue(current: dict) -> bool:
    state_name = str((current.get("state") or {}).get("name") or "").strip().lower()
    if state_name == "blocked":
        return True
    for label in current.get("labels", []) or []:
        if str((label or {}).get("name") or "").strip().lower() == "blocked":
            return True
    return False


def check_blocked_via_linear(state: dict) -> int:
    count = 0
    for issue_id in list(state.get("issues", {}).keys()):
        local = state["issues"][issue_id]
        if local.get("status") not in ("dispatched", "dispatching", "needs-review"):
            continue
        try:
            current = orca("linear", "issue", issue_id, "--workspace", LINEAR_WORKSPACE_ID).get("issue", {})
        except Exception:
            log_exception_safe("Blocked check failed for %s", issue_id)
            continue
        if not linear_scope_ok(current):
            continue
        if not is_blocked_issue(current):
            continue
        local["status"] = "blocked"
        save_state(state)
        count += 1
    return count


def check_dispatch_timeouts(state: dict, now: int | None = None) -> int:
    moment = now if now is not None else utc_epoch()
    count = 0
    for issue_id in list(state.get("issues", {}).keys()):
        local = state.get("issues", {}).get(issue_id, {})
        if local.get("status") not in ("claiming", "dispatching"):
            continue
        claimed = local.get("claimedAt")
        if claimed is None:
            claimed = local.get("dispatchedAt")
        if claimed is None:
            claimed = moment
        try:
            claimed_int = int(claimed)
        except (TypeError, ValueError):
            claimed_int = moment
        if moment - claimed_int < DISPATCH_TIMEOUT_SECONDS:
            continue
        try:
            current = orca("linear", "issue", issue_id, "--workspace", LINEAR_WORKSPACE_ID).get("issue", {})
        except Exception:
            log_exception_safe("Timeout check failed for %s", issue_id)
            continue
        if not linear_scope_ok(current):
            continue
        if str((current.get("state") or {}).get("name") or "") == "In Progress":
            local.update({"status": "dispatched", "confirmedLateAt": moment})
            save_state(state)
            continue
        try:
            if mark_dispatch_timeout(issue_id, state, now=moment):
                count += 1
        except Exception:
            log_exception_safe("Timeout marking failed for %s", issue_id)
    return count


HERMES_ACK_KIND = "meuplantao-ack:"


def hermes_acknowledged(bodies: list[str], fingerprint: str) -> bool:
    want = HERMES_ACK_KIND + " " + str(fingerprint).strip().lower()
    for body in bodies:
        for line in str(body).splitlines():
            if line.strip().lower() == want:
                return True
    return False


def unacked_hermes_events(state: dict) -> list[dict]:
    pending_events: list[dict] = []
    for issue_id in list(state.get("issues", {}).keys()):
        local = state.get("issues", {}).get(issue_id, {})
        pending = pending_hermes_event(issue_id, local)
        if pending is None:
            continue
        event_type, fingerprint = pending
        try:
            current = fetch_linear_issue_full(issue_id)
        except Exception:
            log_exception_safe("Hermes precheck fetch failed for %s", issue_id)
            pending_events.append({"issue": issue_id, "event": event_type,
                                   "fingerprint": fingerprint, "linearReachable": False,
                                   "expectedAck": None})
            continue
        if not linear_scope_ok(current):
            continue
        bodies = extract_comment_bodies(current)
        if hermes_acknowledged(bodies, fingerprint):
            continue
        if event_type == "needs-review":
            detail = local.get("reviewMarker") or ""
        elif event_type == "dispatch-timeout":
            detail = local.get("dispatchId") or ""
        else:
            detail = ""
        pending_events.append({"issue": issue_id, "event": event_type,
                               "fingerprint": fingerprint, "linearReachable": True,
                               "expectedAck": expected_hermes_ack(issue_id, event_type, bodies, detail)})
    return pending_events


def hermes_precheck(state: dict) -> tuple[list[dict], int]:
    events = unacked_hermes_events(state)
    return events, (0 if events else 1)


def hermes_precheck_main() -> int:
    state = load_state()
    events, code = hermes_precheck(state)
    print(json.dumps({"events": events}, ensure_ascii=False))
    return code


def poll_linear_outcomes(state: dict, now: int | None = None) -> None:
    sync_worker_reports(state)
    check_dispatch_timeouts(state, now=now)
    check_blocked_via_linear(state)
    deliver_hermes_notifications(state)


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
    pr = canonical_pr(pr)
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
            stages["attachmentError"] = sanitize_for_linear(str(exc), 500); save_state(state); raise
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
            stages["commentError"] = sanitize_for_linear(str(exc), 500); save_state(state); raise
        stages["commentDone"] = True; save_state(state)
    issue_state.update({"status": "needs-review", "reviewMarker": marker, "pr": pr["url"], "headSha": pr["headRefOid"], "reviewAt": utc_epoch()}); save_state(state)
    LOG.info("Marked %s for review from PR #%s", issue_id, pr["number"])
def monitor_deliveries(state: dict, worktrees: list[dict]) -> None:
    preflight_model()
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
            pending = state.get("issues", {}).get(issue_id, {})
            report = pending.get("workerReport") or {}
            if not isinstance(report, dict) or report.get("kind") != "delivery" or not report.get("pr") or not report.get("sha"):
                continue
            pr = gh_pr_for_branch(branch)
            if not pr:
                continue
            pr = canonical_pr(pr)
            if str(pr.get("url") or "") != report["pr"]:
                continue
            if str(pr.get("headRefOid") or "").lower() != report["sha"]:
                continue
            mark_for_review(issue_id, pr, state)
        except Exception:
            log_exception_safe("Delivery monitor failed for %s", issue_id)


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
    parser.add_argument("--hermes-precheck", action="store_true", help="Read-only gate: list unacknowledged Hermes events as JSON (exit 0 when pending, 1 when quiet)")
    args = parser.parse_args()
    if args.hermes_precheck:
        return hermes_precheck_main()

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
        if not args.dry_run:
            poll_linear_outcomes(state)
        status = orca("status")
        if not status.get("runtime", {}).get("reachable"):
            raise RuntimeError("Orca runtime is not reachable")
        worktrees = list_worktrees()
        if not args.dry_run:
            reconcile_dispatches(state, worktrees)
            monitor_deliveries(state, worktrees)
            poll_linear_outcomes(state)
        if paused and not args.dry_run:
            record_runtime(state, mode, 0, "paused for new tasks; reconcile and monitor continued", manual_once)
            save_state(state)
            monitor_deliveries(state, worktrees)
            poll_linear_outcomes(state)
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
            poll_linear_outcomes(state)
            record_runtime(state, mode, dispatched, f"eligible={len(issues)} dispatched={dispatched} manual_once={manual_once}", manual_once)
            save_state(state)
        LOG.info("Run complete eligible=%d dispatched=%d dry_run=%s mode=%s manual_once=%s", len(issues), dispatched, args.dry_run, mode, manual_once)
        return 0
    except Exception as exc:
        log_exception_safe("Dispatcher run failed: %s", exc)
        return 1
    finally:
        try:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
