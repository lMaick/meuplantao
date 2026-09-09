from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTROL_STATE_PATH = ROOT / "control-state.json"
VALID_MODES = ("AUTO", "PAUSED")

def is_initialized(path: Path | None = None) -> bool:
    state_path = path or CONTROL_STATE_PATH
    return state_path.exists()

def get_mode(path: Path | None = None, config_valid=None) -> str:
    state_path = path or CONTROL_STATE_PATH
    if not state_path.exists():
        raise RuntimeError(
            f"control state missing (fail closed): {state_path}; "
            "run explicit bootstrap after validating config"
        )
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"control state corrupt: {state_path}") from exc
    mode = payload.get("mode") if isinstance(payload, dict) else None
    if mode not in VALID_MODES:
        raise RuntimeError(f"control state invalid mode: {mode!r}")
    return mode

def set_mode(mode: str, path: Path | None = None) -> str:
    if mode not in VALID_MODES:
        raise ValueError(f"unsupported control mode: {mode!r}")
    state_path = path or CONTROL_STATE_PATH
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"mode": mode}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, state_path)
    return mode

def bootstrap_auto(path: Path | None = None, config_valid=None) -> str:
    state_path = path or CONTROL_STATE_PATH
    if state_path.exists():
        raise RuntimeError(f"control state already exists, refusing bootstrap overwrite: {state_path}")
    if not _config_ok(config_valid):
        raise RuntimeError("refusing bootstrap: dispatcher config is missing or invalid")
    return set_mode("AUTO", state_path)

def _config_ok(config_valid) -> bool:
    if config_valid is None:
        try:
            import dispatcher
            dispatcher.load_config()
            return True
        except Exception:
            return False
    try:
        result = config_valid() if callable(config_valid) else bool(config_valid)
    except Exception:
        return False
    return bool(result)
