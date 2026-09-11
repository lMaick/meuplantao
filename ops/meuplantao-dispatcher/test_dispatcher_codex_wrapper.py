import sys
from pathlib import Path
import json
import os
import tempfile
import unittest
from unittest.mock import patch

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
    "auth_mode = \"opencode\"\n",
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


def _settings_path(tmp, payload):
    path = Path(tmp) / ("settings-" + next(tempfile._get_candidate_names()) + ".json")
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _settings_raw(tmp, text):
    path = Path(tmp) / ("settings-" + next(tempfile._get_candidate_names()) + ".json")
    path.write_text(text, encoding="utf-8")
    return path


def _good_payload(override):
    return {"settings": {"agentCmdOverrides": {"codex": override}}}


class CodexWrapperRedTests(unittest.TestCase):
    def test_red_diverging_codex_config_with_effective_wrapper_succeeds(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")
        self.assertEqual(matched["command"], "codex")


class CodexWrapperGreenTests(unittest.TestCase):
    def test_green_string_override_ignores_diverging_codex_config(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["model"], "muse-spark-1.3-contributor")
        self.assertEqual(matched["provider"], "opencode-go")
        self.assertEqual(matched["reasoning"], "high")

    def test_green_dict_override(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(dict(GOOD_DICT_OVERRIDE)))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")

    def test_green_toplevel_overrides_without_settings_nesting(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, {"agentCmdOverrides": {"codex": GOOD_OVERRIDE}})
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["id"], "codex-spark")

    def test_effective_command_remains_codex(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    matched = dispatcher.preflight_model(home=home)
        self.assertEqual(matched["command"], "codex")
        self.assertEqual(matched["identity"], "codex")

    def test_recovery_creates_terminal_with_codex_command(self):
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
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with patch.object(dispatcher, "orca", side_effect=fake_orca):
                        with patch.object(dispatcher, "wait_for_worker", return_value=("h-81", {})):
                            handle = dispatcher.recover_existing(
                                {"identifier": "MAI-81"},
                                {"path": "C:/w/MAI-81", "displayName": "MAI-81-w"},
                                worker=dict(SPARK_CODEX_ENTRY),
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
            missing = Path(d) / "nope-81.json"
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(missing)}):
                    with self.assertRaisesRegex(RuntimeError, "wrapper missing"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_key_missing_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, {"settings": {"agentCmdOverrides": {}}})
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "wrapper missing"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_command_not_resolved(self):
        bad = dict(SPARK_CODEX_ENTRY)
        bad["command"] = "opencode"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark", bad)):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "command not resolved"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_quoting_ambiguous(self):
        bad_override = "opencode --model \"muse-spark-1.3-contributor --provider opencode-go"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
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
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
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
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "wrapper ambiguous"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_field_missing(self):
        bad_override = "opencode --model muse-spark-1.3-contributor --reasoning high"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "field missing"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_model_divergent(self):
        bad_override = "opencode --model gpt-outro --provider opencode-go --reasoning high"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "model mismatch"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_provider_divergent(self):
        bad_override = "opencode --model muse-spark-1.3-contributor --provider outro --reasoning high"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "provider mismatch"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_reasoning_divergent(self):
        bad_override = "opencode --model muse-spark-1.3-contributor --provider opencode-go --reasoning low"
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(bad_override))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "reasoning mismatch"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_malformed_json(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_raw(d, "{nao-json-valido")
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "wrapper malformed"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_malformed_type(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d)
            settings = _settings_path(d, _good_payload(12345))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaisesRegex(RuntimeError, "wrapper malformed"):
                        dispatcher.preflight_model(home=home)

    def test_wrapper_auth_missing_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _home_with_diverging_codex(d, with_opencode_auth=False)
            settings = _settings_path(d, _good_payload(GOOD_OVERRIDE))
            with patch.object(dispatcher, "CONFIG", _config("codex-spark")):
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
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
                with patch.dict(os.environ, {"MEUPLANTAO_ORCA_SETTINGS": str(settings)}):
                    with self.assertRaises(RuntimeError) as ctx:
                        dispatcher.preflight_model(home=home)
            message = str(ctx.exception)
            self.assertNotIn(secret, message)
            self.assertNotIn("api_key", message.lower())
            self.assertNotIn("outro", message)


if __name__ == "__main__":
    unittest.main()
