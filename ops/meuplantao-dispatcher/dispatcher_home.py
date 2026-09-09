from __future__ import annotations

import os
import sys
import tomllib
from pathlib import Path

REQUIRED_CONFIG_KEYS = (
    "orca_dir", "repo_name", "repo_path", "worktree_root",
    "linear_workspace_id", "team", "project", "gh_executable", "github_repo",
)
DEFAULT_TASK_NAME = "Hermes-MeuPlantao-Dispatcher"

def _env(name: str) -> str:
    value = os.environ.get(name, "")
    return value.strip()

def home() -> Path:
    explicit = _env("MEUPLANTAO_DISPATCHER_HOME")
    if explicit:
        return Path(os.path.expandvars(explicit)).expanduser()
    config = _env("MEUPLANTAO_DISPATCHER_CONFIG")
    if config:
        return Path(os.path.expandvars(config)).expanduser().parent
    if getattr(sys, "frozen", False):
        raise RuntimeError(
            "frozen bundle cannot use its temp dir as dispatcher home; "
            "set MEUPLANTAO_DISPATCHER_HOME or MEUPLANTAO_DISPATCHER_CONFIG"
        )
    return Path(__file__).resolve().parent

def config_path(path: Path | str | None = None) -> Path:
    if path is not None:
        return Path(os.path.expandvars(str(path))).expanduser()
    config = _env("MEUPLANTAO_DISPATCHER_CONFIG")
    if config:
        return Path(os.path.expandvars(config)).expanduser()
    return home() / "config.toml"

def load_config_dict(path: Path | str | None = None) -> dict:
    config_file = config_path(path)
    if not config_file.exists():
        raise RuntimeError(f"missing dispatcher config: {config_file}")
    config = tomllib.loads(config_file.read_text(encoding="utf-8"))
    missing = [k for k in REQUIRED_CONFIG_KEYS if k not in config or config[k] is None or (k != "gh_executable" and not config[k])]
    if missing:
        raise RuntimeError("missing dispatcher config keys: " + ", ".join(missing))
    if any("<" in str(config[k]) or ">" in str(config[k]) for k in REQUIRED_CONFIG_KEYS):
        raise RuntimeError("dispatcher config contains unresolved placeholders")
    if any("S-1-5-" in str(config[k]) for k in REQUIRED_CONFIG_KEYS):
        raise RuntimeError("machine-specific SID hardcode is forbidden; use config")
    return config

def task_name(config: dict | None = None) -> str:
    if config is None:
        try:
            config = load_config_dict()
        except Exception:
            return DEFAULT_TASK_NAME
    name = str((config or {}).get("scheduler_task_name", "") or "").strip()
    return name or DEFAULT_TASK_NAME

def dispatcher_script() -> Path:
    return home() / "dispatcher.py"

def state_path() -> Path:
    return home() / "state.json"

def log_path() -> Path:
    return home() / "dispatcher.log"

def lock_path() -> Path:
    return home() / "dispatcher.lock"

def control_state_path() -> Path:
    return home() / "control-state.json"
