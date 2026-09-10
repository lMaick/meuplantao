import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import os
_fixture = Path(tempfile.gettempdir()) / "mai67-worker-policy-config.toml"
if not _fixture.exists():
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
        "[[allowed_workers]]\n"
        "id = \"codex-luna\"\n"
        "agent = \"codex\"\n"
        "model = \"gpt-5.6-luna\"\n"
        "reasoning = \"low\"\n"
        "auth_mode = \"chatgpt\"\n"
        "[[allowed_workers]]\n"
        "id = \"opencode-spark\"\n"
        "agent = \"opencode-go\"\n"
        "model = \"muse-spark-1.3-contributor\"\n"
        "reasoning = \"medium\"\n"
        "provider = \"opencode-go\"\n",
        encoding="utf-8",
    )
os.environ["MEUPLANTAO_DISPATCHER_CONFIG"] = str(_fixture)

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher


POLICY = [
    {"id": "codex-luna", "agent": "codex", "model": "gpt-5.6-luna", "reasoning": "low", "auth_mode": "chatgpt"},
    {"id": "opencode-spark", "agent": "opencode-go", "model": "muse-spark-1.3-contributor", "reasoning": "medium", "provider": "opencode-go"},
]


def _codex_home(tmp: str, model="gpt-5.6-luna", reasoning="low", auth_mode="chatgpt", routing=""):
    base = Path(tmp)
    codex = base / ".codex"
    codex.mkdir(parents=True, exist_ok=True)
    extra = "\n" + routing + "\n" if routing else ""
    (codex / "config.toml").write_text(f"model = \"{model}\"\nmodel_reasoning_effort = \"{reasoning}\"\n" + extra, encoding="utf-8")
    (codex / "auth.json").write_text("{\"auth_mode\": \"" + auth_mode + "\"}", encoding="utf-8")
    return base


def _opencode_home(tmp: str, model="muse-spark-1.3-contributor", reasoning="medium", provider="opencode-go"):
    base = Path(tmp)
    target = base / ".config" / "opencode"
    target.mkdir(parents=True, exist_ok=True)
    (target / "opencode.json").write_text(
        "{\"model\": \"" + model + "\", \"reasoning\": \"" + reasoning + "\", \"provider\": \"" + provider + "\"}",
        encoding="utf-8",
    )
    return base


class WorkerPolicyTests(unittest.TestCase):
    def test_allows_codex_luna(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "codex-luna")

    def test_allows_opencode_spark(self):
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d)
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "opencode-spark")

    def test_unauthorized_model_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, model="gpt-9-unknown")
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaisesRegex(RuntimeError, "model"):
                    dispatcher.preflight_model(home=home)

    def test_unauthorized_reasoning_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, reasoning="high")
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaisesRegex(RuntimeError, "reasoning"):
                    dispatcher.preflight_model(home=home)

    def test_divergent_provider_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d, provider="other-provider")
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaisesRegex(RuntimeError, "provider"):
                    dispatcher.preflight_model(home=home)

    def test_incompatible_auth_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, auth_mode="oauth")
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaisesRegex(RuntimeError, "auth"):
                    dispatcher.preflight_model(home=home)

    def test_forbidden_routing_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, routing="model_provider = \"openrouter\"")
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaisesRegex(RuntimeError, "routing"):
                    dispatcher.preflight_model(home=home)

    def test_missing_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", {}):
                with self.assertRaisesRegex(RuntimeError, "policy missing"):
                    dispatcher.preflight_model(home=home)

    def test_empty_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": []}):
                with self.assertRaisesRegex(RuntimeError, "policy empty"):
                    dispatcher.preflight_model(home=home)

    def test_missing_worker_config_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaisesRegex(RuntimeError, "config missing"):
                    dispatcher.preflight_model(home=Path(d))

    def test_errors_never_leak_secrets(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, model="gpt-9-unknown")
            secret = "sk-super-secret-123"
            (home / ".codex" / "auth.json").write_text("{\"auth_mode\": \"chatgpt\", \"token\": \"" + secret + "\"}", encoding="utf-8")
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaises(RuntimeError) as ctx:
                    dispatcher.preflight_model(home=home)
            message = str(ctx.exception)
            self.assertNotIn(secret, message)
            self.assertNotIn("token", message.lower())

    def test_tail_matches_both_authorized_workers(self):
        with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
            self.assertTrue(dispatcher.tail_matches_allowed_worker("model:       gpt-5.6-luna low"))
            self.assertTrue(dispatcher.tail_matches_allowed_worker("muse-spark-1.3-contributor medium"))
            self.assertFalse(dispatcher.tail_matches_allowed_worker("gpt-9-unknown high"))


if __name__ == "__main__":
    unittest.main()
