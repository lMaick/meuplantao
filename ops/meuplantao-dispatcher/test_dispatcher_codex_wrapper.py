import sys
from pathlib import Path
import json
import os
import tempfile
import contextlib
import unittest
from unittest.mock import patch, MagicMock

_fixture = Path(tempfile.gettempdir()) / "mai81-wrapper-policy-config.toml"
_fixture.write_text(
    "orca_dir = \"C:/orca\"\n"
    "gh_executable = \"\"\n"
    "github_repo = \"example/repository\"\n"
    "repo_name = \"meuplantao\"\n"
    "repo_path = \"C:/repo\"\n"
    "worktree_root = \"C:/worktrees\"\n"
    "linear_workspace_id = \"workspace-id\"\n"
    "team = \"Team\"\n"
    "project = \"Proj\"\n"
    "worker_id = \"codex-spark\"\n"
    "[[allowed_workers]]\n"
    "id = \"codex-spark\"\n"
    "agent = \"codex\"\n"
    "model = \"muse-spark-1.3-contributor\"\n"
    "provider = \"opencode-go\"\n"
    "reasoning = \"high\"\n"
    "command = \"codex\"\n"
    "identity = \"codex\"\n"
    "auth_mode = \"opencode\"\n"
    "wrapper_executable = \"opencode\"\n",
    encoding="utf-8",
)
os.environ["MEUPLANTAO_DISPATCHER_CONFIG"] = str(_fixture)

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher

SPARK_CODEX_ENTRY = {
    "id": "codex-spark",
    "agent": "codex",
    "model": "muse-spark-1.3-contributor",
    "provider": "opencode-go",
    "reasoning": "high",
    "command": "codex",
    "identity": "codex",
    "auth_mode": "opencode",
    "wrapper_executable": "opencode",
}

NATIVE_CODEX_ENTRY = {
    "id": "codex-luna",
    "agent": "codex",
    "model": "gpt-5.6-luna",
    "reasoning": "low",
    "command": "codex",
    "identity": "codex",
    "auth_mode": "chatgpt",
}

GOOD_OVERRIDE = (
    "opencode --model muse-spark-1.3-contributor"
    " --provider opencode-go --reasoning high"
)

GOOD_DICT_OVERRIDE = {
    "model": "muse-spark-1.3-contributor",
    "provider": "opencode-go",
    "reasoning": "high",
}


def _config(worker_id, entry=None):
    ent = dict(entry) if entry is not None else dict(SPARK_CODEX_ENTRY)
    return {"allowed_workers": [ent], "worker_id": worker_id}


def _home_with_diverging_codex(tmp, with_opencode_auth=True, opencode_auth_mode="opencode"):
    base = Path(tmp)
    codex = base / ".codex"
    codex.mkdir(parents=True, exist_ok=True)
    (codex / "config.toml").write_text(
        "model = \"gpt-5.6-sol\"\nmodel_reasoning_effort = \"low\"\n",
        encoding="utf-8",
    )
    (codex / "auth.json").write_text("{\"auth_mode\": \"chatgpt\"}", encoding="utf-8")
    if with_opencode_auth:
        target = base / ".config" / "opencode"
        target.mkdir(parents=True, exist_ok=True)
        (target / "auth.json").write_text(
            "{\"auth_mode\": \"" + opencode_auth_mode + "\"}",
            encoding="utf-8",
        )
    return base


def _orca_state(tmp, payload, profile="profile-a"):
    root = Path(tmp) / "orca-user"
    profdir = root / "profiles" / profile
    profdir.mkdir(parents=True, exist_ok=True)
    (root / "orca-profile-index.json").write_text(
        json.dumps({"activeProfileId": profile, "profiles": [{"id": profile}]}),
        encoding="utf-8",
    )
    (root / "orca-runtime.json").write_text(
        json.dumps({"pid": 12345}),
        encoding="utf-8",
    )
    data_path = profdir / "orca-data.json"
    data_path.write_text(json.dumps(payload), encoding="utf-8")
    return data_path


def _orca_state_raw(tmp, text, profile="profile-a"):
    root = Path(tmp) / "orca-user"
    profdir = root / "profiles" / profile
    profdir.mkdir(parents=True, exist_ok=True)
    (root / "orca-profile-index.json").write_text(
        json.dumps({"activeProfileId": profile, "profiles": [{"id": profile}]}),
        encoding="utf-8",
    )
    (root / "orca-runtime.json").write_text(
        json.dumps({"pid": 12345}),
        encoding="utf-8",
    )
    data_path = profdir / "orca-data.json"
    data_path.write_text(text, encoding="utf-8")
    return data_path


def _settings_path(tmp, payload):
    return _orca_state(tmp, payload)


def _settings_raw(tmp, text):
    return _orca_state_raw(tmp, text)


@contextlib.contextmanager
def _orca_env(tmp, pin=None):
    root = Path(tmp) / "orca-user"
    old_pin = os.environ.pop("MEUPLANTAO_ORCA_SETTINGS", None)
    old_data = os.environ.pop("ORCA_USER_DATA_PATH", None)
    os.environ["ORCA_USER_DATA_PATH"] = str(root)
    if pin is not None:
        os.environ["MEUPLANTAO_ORCA_SETTINGS"] = str(pin)
    try:
        yield root
    finally:
        os.environ.pop("MEUPLANTAO_ORCA_SETTINGS", None)
        os.environ.pop("ORCA_USER_DATA_PATH", None)
        if old_pin is not None:
            os.environ["MEUPLANTAO_ORCA_SETTINGS"] = old_pin
        if old_data is not None:
            os.environ["ORCA_USER_DATA_PATH"] = old_data


def _good_payload(override):
    return {"settings": {"agentCmdOverrides": {"codex": override},
                         "agentDefaultArgs": {"codex": ""}}}


def _payload_with_defaults(override, default_args="", default_env=None):
    settings = {"agentCmdOverrides": {"codex": override},
                "agentDefaultArgs": {"codex": default_args}}
    if default_env is not None:
        settings["agentDefaultEnv"] = default_env
    return {"settings": settings}


class CodexWrapperRedTests(unittest.TestCase):
    def test_red_diverging_codex_config_with_effective_wrapper_succeeds(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")
        self.assertEqual(matched["command"], "codex")


class CodexWrapperGreenTests(unittest.TestCase):
    def test_green_string_override_ignores_diverging_codex_config(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
        self.assertEqual(matched["provider"], "opencode-go")
        self.assertEqual(matched["reasoning"], "high")

    def test_top_level_only_overrides_rejected_as_untrusted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            _settings_path(d, {"agentCmdOverrides": {"codex": GOOD_OVERRIDE}})
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper ambiguous"):
                        dispatcher.preflight_model(home=home)

    def test_effective_command_remains_codex(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["command"], "codex")
        self.assertEqual(matched["identity"], "codex")

    def test_recovery_creates_terminal_with_codex_command_for_native_worker(self):
        seen = {}

        def fake_orca(*args, **kwargs):
            if args[:2] == ("terminal", "list"):
                return {"terminals": []}
            if args[:2] == ("terminal", "create"):
                seen["args"] = list(args)
                return {"terminal": {"handle": "h-81"}}
            if args[:2] == ("terminal", "send"):
                return {}
            raise AssertionError("unexpected orca call: %r" % (args,))

        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            codex = base / ".codex"
            codex.mkdir(parents=True, exist_ok=True)
            (codex / "config.toml").write_text(
                "model = \"gpt-5.6-luna\"\nmodel_reasoning_effort = \"low\"\n",
                encoding="utf-8",
            )
            (codex / "auth.json").write_text("{\"auth_mode\": \"chatgpt\"}", encoding="utf-8")
            native = {"allowed_workers": [dict(NATIVE_CODEX_ENTRY)], "worker_id": "codex-luna"}
            with patch.object(dispatcher, "CONFIG", native):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": "C:/nao-existe/81.json"}):
                    with patch.object(dispatcher, "orca", side_effect=fake_orca):
                        with patch.object(dispatcher, "wait_for_worker", return_value=("h-81", {})):
                            handle = dispatcher.recover_existing(
                                {"identifier": "MAI-81"},
                                {"path": "C:/w/MAI-81", "displayName": "MAI-81-w"},
                                worker=dict(NATIVE_CODEX_ENTRY),
                            )
        self.assertEqual(handle, "h-81")
        self.assertIn("--command", seen["args"])
        idx = seen["args"].index("--command")
        self.assertEqual(seen["args"][idx + 1], "codex")

    def test_native_codex_worker_ignores_wrapper(self):
        entry = {
            "id": "codex-luna",
            "agent": "codex",
            "model": "gpt-5.6-luna",
            "reasoning": "low",
            "command": "codex",
            "identity": "codex",
            "auth_mode": "chatgpt",
        }
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            codex = base / ".codex"
            codex.mkdir(parents=True, exist_ok=True)
            (codex / "config.toml").write_text(
                "model = \"gpt-5.6-luna\"\nmodel_reasoning_effort = \"low\"\n",
                encoding="utf-8",
            )
            (codex / "auth.json").write_text("{\"auth_mode\": \"chatgpt\"}", encoding="utf-8")
            with patch.object(
                dispatcher, "CONFIG",
                {"allowed_workers": [entry], "worker_id": "codex-luna"},
            ):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": "C:/nao-existe/81.json"}):
                    matched = dispatcher.preflight_model(home=base)
        self.assertEqual(matched["id"], "codex-luna")

    def test_hermes_payload_stays_strict(self):
        payload = dispatcher.hermes_payload("mai-81", "needs-review")
        self.assertEqual(payload, {"issue": "MAI-81", "event": "needs-review"})


class CodexWrapperFailClosedTests(unittest.TestCase):
    def test_wrapper_file_missing_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            root = Path(d) / "orca-user"
            (root / "profiles" / "profile-a").mkdir(parents=True, exist_ok=True)
            (root / "orca-profile-index.json").write_text(
                json.dumps({"activeProfileId": "profile-a", "profiles": [{"id": "profile-a"}]}),
                encoding="utf-8",
            )
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper missing"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_key_missing_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, {"settings": {"agentCmdOverrides": {}}})
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper missing"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_command_not_resolved(self):
        bad = dict(SPARK_CODEX_ENTRY)
        bad["command"] = "opencode"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", bad)):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "command not resolved"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_quoting_ambiguous(self):
        bad_override = "opencode --model \"muse-spark-1.3-contributor --provider opencode-go"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper ambiguous"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_duplicate_flag_ambiguous(self):
        bad_override = (
            "opencode --model muse-spark-1.3-contributor --model other"
            " --provider opencode-go --reasoning high"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper ambiguous"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_dual_nesting_ambiguous(self):
        payload = {
            "agentCmdOverrides": {"codex": GOOD_OVERRIDE},
            "settings": {"agentCmdOverrides": {"codex": "opencode --model other --provider opencode-go --reasoning high"}},
        }
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, payload)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper ambiguous"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_field_missing(self):
        bad_override = "opencode --model muse-spark-1.3-contributor --reasoning high"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "field missing"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_model_divergent(self):
        bad_override = "opencode --model gpt-outro --provider opencode-go --reasoning high"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "model mismatch"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_provider_divergent(self):
        bad_override = "opencode --model muse-spark-1.3-contributor --provider outro --reasoning high"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "provider mismatch"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_reasoning_divergent(self):
        bad_override = "opencode --model muse-spark-1.3-contributor --provider opencode-go --reasoning low"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "reasoning mismatch"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_malformed_json(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_raw(d, "{nao-json-valido")
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper malformed"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_malformed_type(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(12345))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper malformed"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_auth_missing_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d, with_opencode_auth=False)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "auth mismatch"):
                        dispatcher.preflight_model(home=home)

    def test_errors_never_leak_secrets(self):
        secret = "sk-mai81-super-secret-xyz"
        bad_override = "opencode --model muse-spark-1.3-contributor --provider outro --reasoning high"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            target = home / ".config" / "opencode"
            (target / "auth.json").write_text(
                "{\"auth_mode\": \"opencode\", \"api_key\": \"" + secret + "\"}",
                encoding="utf-8",
            )
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaises(RuntimeError) as ctx:
                        dispatcher.preflight_model(home=home)
            message = str(ctx.exception)
            self.assertNotIn(secret, message)
            self.assertNotIn("api_key", message.lower())
            self.assertNotIn("outro", message)



class CodexWrapperSourceAuthorityTests(unittest.TestCase):
    def test_red_stale_pin_with_divergent_active_state_rejected(self):
        divergent = _good_payload(
            "opencode --model outro-modelo --provider opencode-go --reasoning high"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            _orca_state(d, divergent)
            stale = Path(d) / "stale-81.json"
            stale.write_text(json.dumps(_good_payload(GOOD_OVERRIDE)), encoding="utf-8")
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d, pin=stale):
                    with self.assertRaisesRegex(RuntimeError, "not authoritative"):
                        dispatcher.preflight_model(home=home)

    def test_red_top_level_only_override_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            _orca_state(d, {"agentCmdOverrides": {"codex": GOOD_OVERRIDE}})
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper ambiguous"):
                        dispatcher.preflight_model(home=home)

    def test_green_active_profile_state_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            _orca_state(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")
        self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
        self.assertEqual(matched["provider"], "opencode-go")
        self.assertEqual(matched["reasoning"], "high")
        self.assertEqual(matched["command"], "codex")

    def test_red_profile_switch_with_stale_pin_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            root = Path(d) / "orca-user"
            for profile in ("profile-a", "profile-b"):
                (root / "profiles" / profile).mkdir(parents=True, exist_ok=True)
            (root / "profiles" / "profile-a" / "orca-data.json").write_text(
                json.dumps(_good_payload(GOOD_OVERRIDE)), encoding="utf-8")
            (root / "profiles" / "profile-b" / "orca-data.json").write_text(
                json.dumps(_good_payload(
                    "opencode --model outro-modelo --provider opencode-go --reasoning high")),
                encoding="utf-8")
            (root / "orca-profile-index.json").write_text(
                json.dumps({"activeProfileId": "profile-b",
                            "profiles": [{"id": "profile-a"}, {"id": "profile-b"}]}),
                encoding="utf-8")
            stale_pin = root / "profiles" / "profile-a" / "orca-data.json"
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d, pin=stale_pin):
                    with self.assertRaisesRegex(RuntimeError, "not authoritative"):
                        dispatcher.preflight_model(home=home)

    def test_red_switched_profile_missing_state_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            root = Path(d) / "orca-user"
            (root / "profiles" / "profile-a").mkdir(parents=True, exist_ok=True)
            (root / "profiles" / "profile-a" / "orca-data.json").write_text(
                json.dumps(_good_payload(GOOD_OVERRIDE)), encoding="utf-8")
            (root / "orca-profile-index.json").write_text(
                json.dumps({"activeProfileId": "profile-b",
                            "profiles": [{"id": "profile-a"}, {"id": "profile-b"}]}),
                encoding="utf-8")
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper missing"):
                        dispatcher.preflight_model(home=home)

    def test_pin_equal_to_authoritative_path_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            authoritative = _orca_state(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d, pin=authoritative):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")

    def test_legacy_orca_data_fallback_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            root = Path(d) / "orca-user"
            root.mkdir(parents=True, exist_ok=True)
            (root / "orca-data.json").write_text(
                json.dumps(_good_payload(GOOD_OVERRIDE)), encoding="utf-8")
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")



class CodexWrapperDefaultArgsTests(unittest.TestCase):
    def _check_payload(self, payload, pattern):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            _orca_state(d, payload)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, pattern):
                        dispatcher.preflight_model(home=home)

    def test_red_default_args_model_override_rejected(self):
        self._check_payload(
            _payload_with_defaults(GOOD_OVERRIDE, "--model outro"),
            "unauthorized default args")

    def test_red_default_args_extra_flag_rejected(self):
        self._check_payload(
            _payload_with_defaults(GOOD_OVERRIDE, "--verbose"),
            "unauthorized default args")

    def test_red_default_args_codex_yolo_flag_rejected(self):
        self._check_payload(
            _payload_with_defaults(
                GOOD_OVERRIDE, "--dangerously-bypass-approvals-and-sandbox"),
            "unauthorized default args")

    def test_red_default_args_missing_rejected(self):
        self._check_payload(
            {"settings": {"agentCmdOverrides": {"codex": GOOD_OVERRIDE}}},
            "default args missing")

    def test_red_default_env_non_empty_rejected(self):
        self._check_payload(
            _payload_with_defaults(
                GOOD_OVERRIDE, "", {"codex": {"SOME_ROUTING_VAR": "1"}}),
            "unauthorized default env")

    def test_red_default_env_malformed_rejected(self):
        self._check_payload(
            _payload_with_defaults(GOOD_OVERRIDE, "", {"codex": "nao-dict"}),
            "wrapper malformed")

    def test_green_empty_default_args_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            _orca_state(d, _payload_with_defaults(GOOD_OVERRIDE, ""))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")
        self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
        self.assertEqual(matched["provider"], "opencode-go")
        self.assertEqual(matched["reasoning"], "high")

    def test_green_exact_operational_route_without_extras_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            _orca_state(d, _payload_with_defaults(GOOD_OVERRIDE, "", {}))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")
        self.assertEqual(matched["command"], "codex")


if __name__ == "__main__":
    unittest.main()

class CodexWrapperAuditRedTests(unittest.TestCase):
    def test_red_wrapper_recovery_fails_closed_without_literal_create(self):
        calls = []

        def fake_orca(*args, **kwargs):
            calls.append(tuple(args[:2]))
            if args[:2] == ("terminal", "list"):
                return {"terminals": []}
            if args[:2] == ("terminal", "create"):
                return {"terminal": {"handle": "h-should-not-exist"}}
            if args[:2] == ("terminal", "send"):
                return {}
            raise AssertionError("unexpected orca call: %r" % (args,))

        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with patch.object(dispatcher, "orca", side_effect=fake_orca):
                        with patch.object(dispatcher, "wait_for_worker", return_value=("h-x", {})):
                            with self.assertRaisesRegex(RuntimeError, "recovery unavailable"):
                                dispatcher.recover_existing(
                                    {"identifier": "MAI-81"},
                                    {"path": "C:/w/MAI-81", "displayName": "MAI-81-w"},
                                    worker=dict(SPARK_CODEX_ENTRY),
                                )
        self.assertNotIn(("terminal", "create"), calls)

    def test_red_arbitrary_executable_with_correct_flags_rejected(self):
        evil = "evil-bin --model muse-spark-1.3-contributor --provider opencode-go --reasoning high"
        entry = dict(SPARK_CODEX_ENTRY)
        entry["wrapper_executable"] = "opencode"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(evil))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "command not resolved"):
                        dispatcher.preflight_model(home=home)

    def test_red_dict_override_rejected_as_non_string_schema(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(dict(GOOD_DICT_OVERRIDE)))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper malformed"):
                        dispatcher.preflight_model(home=home)

    def test_red_list_override_rejected_as_non_string_schema(self):
        override = ["opencode", "--model", "muse-spark-1.3-contributor",
                    "--provider", "opencode-go", "--reasoning", "high"]
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper malformed"):
                        dispatcher.preflight_model(home=home)

    def test_red_policy_without_wrapper_executable_rejected(self):
        entry = dict(SPARK_CODEX_ENTRY)
        entry.pop("wrapper_executable", None)
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, "wrapper_executable"):
                        dispatcher.preflight_model(home=home)

    def test_create_uses_agent_aware_worktree_route(self):
        seen = []

        def fake_orca(*args, **kwargs):
            seen.append(list(args))
            if args[:2] == ("worktree", "create"):
                return {"worktree": {"id": "wt-81", "path": "C:/w/MAI-81",
                                     "displayName": "MAI-81-w", "linkedLinearIssue": "MAI-81"}}
            if args[:2] == ("terminal", "list"):
                return {"terminals": [{"handle": "h-81", "agentIdentity": "codex"}]}
            raise AssertionError("unexpected orca call: %r" % (args,))

        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with patch.object(dispatcher, "orca", side_effect=fake_orca):
                        with patch.object(dispatcher, "wait_for_worker", return_value=("h-81", {})):
                            worktree, handle = dispatcher.create_workspace(
                                {"identifier": "MAI-81", "title": "Auditoria"},
                                worker=dict(SPARK_CODEX_ENTRY),
                            )
        self.assertEqual(handle, "h-81")
        create_calls = [c for c in seen if c[:2] == ["worktree", "create"]]
        self.assertEqual(len(create_calls), 1)
        self.assertIn("--agent", create_calls[0])
        self.assertEqual(create_calls[0][create_calls[0].index("--agent") + 1], "codex")
        self.assertFalse(any(c[:2] == ["terminal", "create"] for c in seen))

class CodexWrapperStrictRouteTests(unittest.TestCase):
    def _check_override(self, override, pattern):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    with self.assertRaisesRegex(RuntimeError, pattern):
                        dispatcher.preflight_model(home=home)

    def test_red_chained_command_rejected(self):
        self._check_override(GOOD_OVERRIDE + " && outro-comando", "wrapper unauthorized")

    def test_red_shell_operators_rejected(self):
        for op in (";", "|", "||", "&", ">", ">>", "<"):
            with self.subTest(op=op):
                self._check_override(GOOD_OVERRIDE + " " + op + " x", "wrapper unauthorized")

    def test_red_unknown_flag_rejected(self):
        self._check_override(GOOD_OVERRIDE + " --flag-desconhecida x", "wrapper unauthorized")
        self._check_override(GOOD_OVERRIDE + " --extra=1", "wrapper unauthorized")

    def test_red_trailing_positional_rejected(self):
        self._check_override(GOOD_OVERRIDE + " extra", "wrapper unauthorized")

    def test_exact_operational_route_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with _orca_env(d):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")
        self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
        self.assertEqual(matched["provider"], "opencode-go")
        self.assertEqual(matched["reasoning"], "high")


SANITY_SCRIPT_WRAPPER_CONTENT = (
    "@echo off\n"
    "call \"C:\\fake\\npm\\codex.cmd\" ^\n"
    "  -c \"model='muse-spark-1.3-contributor'\" ^\n"
    "  -c \"model_provider='opencode-go'\" ^\n"
    "  -c \"model_reasoning_effort='high'\" ^\n"
    "  -c \"check_for_update_on_startup=false\" ^\n"
    "  -c \"model_providers.opencode-go.name='OpenCode Go'\" ^\n"
    "  -c \"model_providers.opencode-go.base_url='https://opencode.ai/zen/go/v1'\" ^\n"
    "  -c \"model_providers.opencode-go.env_key='OPENCODE_API_KEY'\" ^\n"
    "  -c \"model_providers.opencode-go.wire_api='responses'\" ^\n"
    "  -c \"features.apps=false\" ^\n"
    "  -c \"features.plugins=false\" ^\n"
    "  -c \"features.browser_use=false\" ^\n"
    "  -c \"features.computer_use=false\" ^\n"
    "  -c \"mcp_servers.node_repl.enabled=false\" ^\n"
    "  %*\n"
)


class CodexScriptWrapperOperationalRouteTests(unittest.TestCase):
    def setUp(self):
        super().setUp()
        self._proc_env_patcher = patch.object(
            dispatcher,
            "read_process_env_block",
            return_value={"OPENCODE_API_KEY": "dummy-runtime-key"},
        )
        self._proc_env_patcher.start()

    def tearDown(self):
        self._proc_env_patcher.stop()
        super().tearDown()

    def _create_script(self, d, content=SANITY_SCRIPT_WRAPPER_CONTENT, name="codex.cmd"):
        script_path = Path(d) / name
        data = content.encode("utf-8")
        script_path.write_bytes(data)
        import hashlib
        digest = hashlib.sha256(data).hexdigest().lower()
        return script_path, digest

    def _good_script_payload(self, script_path, default_args="--dangerously-bypass-approvals-and-sandbox", default_env=None):
        settings = {
            "agentCmdOverrides": {"codex": str(script_path)},
            "agentDefaultArgs": {"codex": default_args} if default_args is not None else {},
        }
        if default_env is not None:
            settings["agentDefaultEnv"] = {"codex": default_env}
        return {"settings": settings}

    def _script_entry(self, script_path, digest, **overrides):
        entry = {
            "id": "codex-spark",
            "agent": "codex",
            "model": "muse-spark-1.3-contributor",
            "provider": "opencode-go",
            "reasoning": "high",
            "command": "codex",
            "identity": "codex",
            "auth_mode": "opencode",
            "wrapper_mode": "script_wrapper",
            "wrapper_path": str(script_path),
            "wrapper_sha256": digest,
        }
        entry.update(overrides)
        return entry

    def test_operational_script_wrapper_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "codex-spark")
            self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
            self.assertEqual(matched["provider"], "opencode-go")
            self.assertEqual(matched["reasoning"], "high")

    def test_red_wrapper_path_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, name="actual.cmd")
            other_path = Path(d) / "configured.cmd"
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(other_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wrapper path mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_hash_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            tampered_digest = "0" * 64
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, tampered_digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wrapper hash mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_missing_file_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path = Path(d) / "nonexistent.cmd"
            digest = "a" * 64
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wrapper missing"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_unauthorized_extension_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, name="codex.exe")
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wrapper unauthorized extension"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_resolves_diverging_model_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace("muse-spark-1.3-contributor", "gpt-5.6-sol")
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "worker model mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_resolves_diverging_provider_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace("opencode-go", "other-provider")
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "worker provider mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_resolves_diverging_reasoning_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace("model_reasoning_effort='high'", "model_reasoning_effort='low'")
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "worker reasoning mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_missing_field_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace("  -c \"model='muse-spark-1.3-contributor'\" ^\n", "")
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wrapper field missing"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_unauthorized_default_args_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path, default_args="--override-model bad"))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "unauthorized default args"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_unauthorized_default_env_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path, default_env={"MODEL": "other"}))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "unauthorized default env"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_missing_auth_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d, with_opencode_auth=False)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    env_clean = dict(os.environ)
                    env_clean.pop("OPENCODE_API_KEY", None)
                    with patch.dict(os.environ, env_clean, clear=True):
                        with self.assertRaisesRegex(RuntimeError, "worker auth mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_policy_invalid_wrapper_mode_rejected(self):
        entry = dict(SPARK_CODEX_ENTRY)
        entry["wrapper_mode"] = "invalid_mode"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with self.assertRaisesRegex(RuntimeError, "invalid wrapper_mode"):
                    dispatcher.preflight_model(home=home)

    def test_red_policy_script_wrapper_missing_path_rejected(self):
        entry = dict(SPARK_CODEX_ENTRY)
        entry["wrapper_mode"] = "script_wrapper"
        entry["wrapper_sha256"] = "a" * 64
        entry.pop("wrapper_path", None)
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with self.assertRaisesRegex(RuntimeError, "missing wrapper_path"):
                    dispatcher.preflight_model(home=home)

    def test_red_policy_script_wrapper_missing_sha256_rejected(self):
        entry = dict(SPARK_CODEX_ENTRY)
        entry["wrapper_mode"] = "script_wrapper"
        entry["wrapper_path"] = "C:/fake/codex.cmd"
        entry.pop("wrapper_sha256", None)
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with self.assertRaisesRegex(RuntimeError, "missing or invalid wrapper_sha256"):
                    dispatcher.preflight_model(home=home)

    def test_red_wrapper_flags_only_in_comments_rejected(self):
        content = (
            "@echo off\n"
            "rem -c \"model='muse-spark-1.3-contributor'\" ^\n"
            "rem -c \"model_provider='opencode-go'\" ^\n"
            "rem -c \"model_reasoning_effort='high'\" ^\n"
            "rem -c \"model_providers.opencode-go.base_url='https://opencode.ai/zen/go/v1'\" ^\n"
            "rem -c \"model_providers.opencode-go.env_key='OPENCODE_API_KEY'\" ^\n"
            "rem -c \"model_providers.opencode-go.wire_api='responses'\"\n"
            "call \"C:\\fake\\npm\\codex.cmd\" %*\n"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wrapper field missing"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_flags_only_in_echo_rejected(self):
        content = (
            "@echo off\n"
            "echo -c \"model='muse-spark-1.3-contributor'\" -c \"model_provider='opencode-go'\" -c \"model_reasoning_effort='high'\"\n"
            "call \"C:\\fake\\npm\\codex.cmd\" %*\n"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wrapper field missing"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_multiple_commands_rejected(self):
        content = (
            "@echo off\n"
            "call \"C:\\fake\\npm\\setup.cmd\"\n"
            + SANITY_SCRIPT_WRAPPER_CONTENT.replace("@echo off\n", "")
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "ambiguous execution route"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_branching_rejected(self):
        content = (
            "@echo off\n"
            "if \"%1\"==\"special\" call \"C:\\fake\\npm\\codex.cmd\" -c \"model='bad'\"\n"
            + SANITY_SCRIPT_WRAPPER_CONTENT.replace("@echo off\n", "")
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "ambiguous execution route"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_chained_operators_rejected(self):
        content = (
            "@echo off\n"
            "set FOO=1 && " + SANITY_SCRIPT_WRAPPER_CONTENT.replace("@echo off\n", "")
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "ambiguous execution route"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_base_url_mismatch_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace(
            "model_providers.opencode-go.base_url='https://opencode.ai/zen/go/v1'",
            "model_providers.opencode-go.base_url='https://evil.com/v1'"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "base_url mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_env_key_mismatch_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace(
            "model_providers.opencode-go.env_key='OPENCODE_API_KEY'",
            "model_providers.opencode-go.env_key='OTHER_KEY'"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key", "OTHER_KEY": "x"}):
                        with self.assertRaisesRegex(RuntimeError, "env_key mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_env_key_duplicate_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace(
            "  -c \"model_providers.opencode-go.env_key='OPENCODE_API_KEY'\" ^\n",
            "  -c \"model_providers.opencode-go.env_key='OPENCODE_API_KEY'\" ^\n  -c \"model_providers.opencode-go.env_key='OPENCODE_API_KEY'\" ^\n"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "duplicate field"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_wire_api_mismatch_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace(
            "model_providers.opencode-go.wire_api='responses'",
            "model_providers.opencode-go.wire_api='chat'"
        )
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "wire_api mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_missing_env_var_rejected_even_with_local_auth_file(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d, with_opencode_auth=True)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    env_clean = dict(os.environ)
                    env_clean.pop("OPENCODE_API_KEY", None)
                    with patch.dict(os.environ, env_clean, clear=True):
                        with self.assertRaisesRegex(RuntimeError, "worker auth mismatch"):
                            dispatcher.preflight_model(home=home)

    def test_red_policy_unauthorized_allowed_default_args_rejected(self):
        entry = dict(SPARK_CODEX_ENTRY)
        entry["wrapper_mode"] = "script_wrapper"
        entry["wrapper_path"] = "C:/fake/codex.cmd"
        entry["wrapper_sha256"] = "a" * 64
        entry["allowed_default_args"] = ["--model", "spark"]
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with self.assertRaisesRegex(RuntimeError, "unauthorized allowed_default_args"):
                    dispatcher.preflight_model(home=home)

    def test_fixture_byte_for_byte_real_wrapper_accepted(self):
        fixture_path = Path(__file__).resolve().parent / "fixtures" / "orca-codex" / "codex.cmd"
        self.assertTrue(fixture_path.is_file(), f"missing fixture {fixture_path}")
        fixture_bytes = fixture_path.read_bytes()
        import hashlib
        digest = hashlib.sha256(fixture_bytes).hexdigest().lower()
        self.assertEqual(digest, "1bac76c48ea73a80de92cc4ee470f485d99585d43d94dc11ba7857df4895f7b1")

        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, self._good_script_payload(fixture_path))
            entry = self._script_entry(fixture_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "codex-spark")
            self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
            self.assertEqual(matched["provider"], "opencode-go")
            self.assertEqual(matched["reasoning"], "high")

    def test_red_wrapper_trailing_control_operators_rejected(self):
        for evil_op in ("&&evil", "&evil", "|evil"):
            bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace("  %*\n", f"  %*{evil_op}\n")
            with tempfile.TemporaryDirectory() as d:
                home = _home_with_diverging_codex(d)
                script_path, digest = self._create_script(d, content=bad_content)
                settings = _settings_path(d, self._good_script_payload(script_path))
                entry = self._script_entry(script_path, digest)
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                            with self.assertRaisesRegex(RuntimeError, "ambiguous execution route"):
                                dispatcher.preflight_model(home=home)

    def test_red_wrapper_redirections_without_spaces_rejected(self):
        for evil_redir in (">evil", "<evil", ">>evil"):
            bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace("  %*\n", f"  %*{evil_redir}\n")
            with tempfile.TemporaryDirectory() as d:
                home = _home_with_diverging_codex(d)
                script_path, digest = self._create_script(d, content=bad_content)
                settings = _settings_path(d, self._good_script_payload(script_path))
                entry = self._script_entry(script_path, digest)
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                            with self.assertRaisesRegex(RuntimeError, "ambiguous execution route"):
                                dispatcher.preflight_model(home=home)

    def test_red_wrapper_second_line_remote_command_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT + "\nremote.exe something\n"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "ambiguous execution route"):
                            dispatcher.preflight_model(home=home)

    def test_red_wrapper_extra_unaccounted_tokens_after_invocation_rejected(self):
        bad_content = SANITY_SCRIPT_WRAPPER_CONTENT.replace("  %*\n", "  %* evil\n")
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d, content=bad_content)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                with _orca_env(d):
                    with patch.dict(os.environ, {"OPENCODE_API_KEY": "dummy-test-key"}):
                        with self.assertRaisesRegex(RuntimeError, "unauthorized token"):
                            dispatcher.preflight_model(home=home)

    def test_red_runtime_env_missing_while_dispatcher_and_registry_have_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)

            # 1. Dispatcher has OPENCODE_API_KEY in os.environ
            # 2. Auxiliary file has OPENCODE_API_KEY
            aux_env_file = Path(d) / "auxiliary.env"
            aux_env_file.write_text("OPENCODE_API_KEY=auxiliary-secret\n", encoding="utf-8")
            # 3. Registry has OPENCODE_API_KEY (simulated / ignored)
            # 4. BUT Orca effective route (process env block) does NOT receive it
            with patch.object(dispatcher, "read_process_env_block", return_value={}):
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dispatcher-secret"}):
                            with self.assertRaisesRegex(RuntimeError, "worker auth mismatch"):
                                dispatcher.preflight_model(home=home)

    def test_green_auth_evidence_strictly_from_effective_route_at_launch(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)

            # Auth evidence comes strictly from the active Orca runtime process environment block inherited by the terminal
            with patch.object(
                dispatcher,
                "read_process_env_block",
                return_value={"OPENCODE_API_KEY": "active-orca-runtime-key"},
            ):
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dispatcher-key"}):
                            matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "codex-spark")
            self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
            self.assertEqual(matched["provider"], "opencode-go")
            self.assertEqual(matched["reasoning"], "high")
            self.assertEqual(matched["command"], "codex")

    def test_discover_active_orca_pid_and_read_authoritative_runtime_env(self):
        with tempfile.TemporaryDirectory() as d:
            user_data = Path(d) / "orca-user"
            user_data.mkdir(parents=True, exist_ok=True)
            (user_data / "orca-runtime.json").write_text(json.dumps({"pid": 4242}), encoding="utf-8")
            pid = dispatcher.discover_active_orca_pid("codex-spark", user_data=user_data)
            self.assertEqual(pid, 4242)

            with patch.object(dispatcher, "read_process_env_block", return_value={"OPENCODE_API_KEY": "live-key"}):
                has_key = dispatcher.read_authoritative_runtime_env("OPENCODE_API_KEY", "codex-spark", user_data=user_data)
                self.assertTrue(has_key)

            with patch.object(dispatcher, "read_process_env_block", return_value={}):
                has_key = dispatcher.read_authoritative_runtime_env("OPENCODE_API_KEY", "codex-spark", user_data=user_data)
                self.assertFalse(has_key)


class WindowsProcessArchitectureSafetyTests(unittest.TestCase):
    def test_inspect_process_architecture_windows_x64(self):
        fake_kernel32 = MagicMock()

        def mock_wow64_2(hProcess, pProc, pNative):
            pProc._obj.value = 0x0000  # IMAGE_FILE_MACHINE_UNKNOWN
            pNative._obj.value = 0x8664  # IMAGE_FILE_MACHINE_AMD64
            return 1

        fake_kernel32.IsWow64Process2.side_effect = mock_wow64_2
        arch = dispatcher.inspect_process_architecture(fake_kernel32, 100)
        self.assertEqual(arch, "x64")

    def test_inspect_process_architecture_wow64_32bit(self):
        fake_kernel32 = MagicMock()

        def mock_wow64_2(hProcess, pProc, pNative):
            pProc._obj.value = 0x014C  # IMAGE_FILE_MACHINE_I386
            pNative._obj.value = 0x8664  # IMAGE_FILE_MACHINE_AMD64
            return 1

        fake_kernel32.IsWow64Process2.side_effect = mock_wow64_2
        arch = dispatcher.inspect_process_architecture(fake_kernel32, 100)
        self.assertEqual(arch, "wow64")

    def test_inspect_process_architecture_fallback_iswow64(self):
        fake_kernel32 = MagicMock(spec=["IsWow64Process"])

        def mock_wow64(hProcess, p_is_wow64):
            p_is_wow64._obj.value = 1
            return 1

        fake_kernel32.IsWow64Process.side_effect = mock_wow64
        arch = dispatcher.inspect_process_architecture(fake_kernel32, 100)
        self.assertEqual(arch, "wow64")

    def test_inspect_process_architecture_undetermined(self):
        fake_kernel32 = MagicMock()
        fake_kernel32.IsWow64Process2.return_value = 0
        fake_kernel32.IsWow64Process.return_value = 0
        arch = dispatcher.inspect_process_architecture(fake_kernel32, 100)
        self.assertEqual(arch, "undetermined")

    def test_red_caller_not_64bit_rejected_fail_closed(self):
        with patch("ctypes.sizeof", return_value=4):
            env, status = dispatcher.probe_process_env_block(12345)
            self.assertIsNone(env)
            self.assertEqual(status, "unsupported_architecture")

    def test_red_target_wow64_32bit_rejected_fail_closed_before_reading_peb_offsets(self):
        fake_kernel32 = MagicMock()
        fake_ntdll = MagicMock()
        fake_kernel32.OpenProcess.return_value = 555
        with patch.object(dispatcher, "_win32_dlls", return_value=(fake_kernel32, fake_ntdll)):
            with patch.object(dispatcher, "inspect_process_architecture", return_value="wow64"):
                env, status = dispatcher.probe_process_env_block(12345)
                self.assertIsNone(env)
                self.assertEqual(status, "unsupported_architecture")
                fake_kernel32.CloseHandle.assert_called_once_with(555)
                fake_ntdll.NtQueryInformationProcess.assert_not_called()
                fake_kernel32.ReadProcessMemory.assert_not_called()

    def test_red_target_undetermined_architecture_rejected_fail_closed_before_reading_peb_offsets(self):
        fake_kernel32 = MagicMock()
        fake_ntdll = MagicMock()
        fake_kernel32.OpenProcess.return_value = 666
        with patch.object(dispatcher, "_win32_dlls", return_value=(fake_kernel32, fake_ntdll)):
            with patch.object(dispatcher, "inspect_process_architecture", return_value="undetermined"):
                env, status = dispatcher.probe_process_env_block(12345)
                self.assertIsNone(env)
                self.assertEqual(status, "undetermined_architecture")
                fake_kernel32.CloseHandle.assert_called_once_with(666)
                fake_ntdll.NtQueryInformationProcess.assert_not_called()
                fake_kernel32.ReadProcessMemory.assert_not_called()

    def test_green_target_windows_x64_supported_reads_peb_environment_block(self):
        fake_kernel32 = MagicMock()
        fake_ntdll = MagicMock()
        fake_kernel32.OpenProcess.return_value = 777

        def fake_nt_query(hProcess, info_class, p_pbi, size, p_ret):
            p_pbi._obj.PebBaseAddress = 0x10000
            return 0

        fake_ntdll.NtQueryInformationProcess.side_effect = fake_nt_query

        def fake_read_mem(hProcess, addr, buf, size, p_read):
            p_read._obj.value = size
            if addr.value == 0x10020:
                buf._obj.value = 0x20000
                return 1
            if addr.value == 0x20080:
                buf._obj.value = 0x30000
                return 1
            if addr.value == 0x30000:
                raw_env = "OPENCODE_API_KEY=test-auth-secret\x00SOME_VAR=hello\x00\x00".encode("utf-16-le")
                import ctypes
                ctypes.memmove(buf, raw_env, len(raw_env))
                p_read._obj.value = len(raw_env)
                return 1
            return 0

        fake_kernel32.ReadProcessMemory.side_effect = fake_read_mem

        with patch.object(dispatcher, "_win32_dlls", return_value=(fake_kernel32, fake_ntdll)):
            with patch.object(dispatcher, "inspect_process_architecture", return_value="x64"):
                env, status = dispatcher.probe_process_env_block(12345)
                self.assertEqual(status, "present")
                self.assertIsNotNone(env)
                self.assertEqual(env.get("OPENCODE_API_KEY"), "test-auth-secret")
                self.assertEqual(env.get("SOME_VAR"), "hello")
                fake_kernel32.CloseHandle.assert_called_once_with(777)
                fake_ntdll.NtQueryInformationProcess.assert_called_once()
                self.assertEqual(fake_kernel32.ReadProcessMemory.call_count, 3)

    def test_close_handle_preserved_on_read_failure(self):
        fake_kernel32 = MagicMock()
        fake_ntdll = MagicMock()
        fake_kernel32.OpenProcess.return_value = 888
        fake_ntdll.NtQueryInformationProcess.return_value = -1
        with patch.object(dispatcher, "_win32_dlls", return_value=(fake_kernel32, fake_ntdll)):
            with patch.object(dispatcher, "inspect_process_architecture", return_value="x64"):
                env, status = dispatcher.probe_process_env_block(12345)
                self.assertIsNone(env)
                self.assertEqual(status, "unavailable")
                fake_kernel32.CloseHandle.assert_called_once_with(888)

    def _create_script(self, d, content=SANITY_SCRIPT_WRAPPER_CONTENT, name="codex.cmd"):
        script_path = Path(d) / name
        script_path.write_text(content, encoding="utf-8")
        import hashlib
        digest = hashlib.sha256(script_path.read_bytes()).hexdigest().lower()
        return script_path, digest

    def _good_script_payload(self, script_path):
        return {"settings": {"agentCmdOverrides": {"codex": str(script_path)},
                             "agentDefaultArgs": {"codex": ""}}}

    def _script_entry(self, script_path, digest, **overrides):
        entry = {
            "id": "codex-spark",
            "agent": "codex",
            "model": "muse-spark-1.3-contributor",
            "reasoning": "high",
            "provider": "opencode-go",
            "command": "codex",
            "identity": "codex",
            "auth_mode": "opencode",
            "wrapper_mode": "script_wrapper",
            "wrapper_path": str(script_path),
            "wrapper_sha256": digest,
        }
        entry.update(overrides)
        return entry

    def test_green_x64_environment_block_with_key_succeeds_preflight(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(
                dispatcher,
                "probe_process_env_block",
                return_value=({"OPENCODE_API_KEY": "active-orca-runtime-key"}, "present"),
            ):
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dispatcher-key"}):
                            matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "codex-spark")
            self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
            self.assertEqual(matched["provider"], "opencode-go")
            self.assertEqual(matched["reasoning"], "high")

    def test_red_x64_environment_block_without_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(
                dispatcher,
                "probe_process_env_block",
                return_value=({"OTHER_VAR": "value"}, "present"),
            ):
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dispatcher-key"}):
                            with self.assertRaisesRegex(RuntimeError, "worker auth mismatch"):
                                dispatcher.preflight_model(home=home)

    def test_red_target_wow64_architecture_fails_closed_in_preflight(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(
                dispatcher,
                "probe_process_env_block",
                return_value=(None, "unsupported_architecture"),
            ):
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dispatcher-key"}):
                            with self.assertRaisesRegex(RuntimeError, "worker auth mismatch"):
                                dispatcher.preflight_model(home=home)

    def test_red_target_undetermined_architecture_fails_closed_in_preflight(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            script_path, digest = self._create_script(d)
            settings = _settings_path(d, self._good_script_payload(script_path))
            entry = self._script_entry(script_path, digest)
            with patch.object(
                dispatcher,
                "probe_process_env_block",
                return_value=(None, "undetermined_architecture"),
            ):
                with patch.object(dispatcher, "CONFIG", _config("codex-spark", entry)):
                    with _orca_env(d):
                        with patch.dict(os.environ, {"OPENCODE_API_KEY": "dispatcher-key"}):
                            with self.assertRaisesRegex(RuntimeError, "worker auth mismatch"):
                                dispatcher.preflight_model(home=home)
