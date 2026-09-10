import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import os
_fixture = Path(tempfile.gettempdir()) / "mai67-worker-policy-config.toml"
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
    "worker_id = \"codex-luna\"\n"
    "[[allowed_workers]]\n"
    "id = \"codex-luna\"\n"
    "agent = \"codex\"\n"
    "model = \"gpt-5.6-luna\"\n"
    "reasoning = \"low\"\n"
    "command = \"codex\"\n"
    "identity = \"codex\"\n"
    "auth_mode = \"chatgpt\"\n"
    "[[allowed_workers]]\n"
    "id = \"opencode-spark\"\n"
    "model = \"muse-spark-1.3-contributor\"\n"
    "reasoning = \"medium\"\n"
    "provider = \"opencode-go\"\n"
    "command = \"opencode\"\n"
    "identity = \"opencode\"\n"
    "auth_mode = \"opencode\"\n",
    encoding="utf-8",
)
os.environ["MEUPLANTAO_DISPATCHER_CONFIG"] = str(_fixture)
_home = Path(tempfile.gettempdir()) / "mai67-worker-home"
(_home / ".codex").mkdir(parents=True, exist_ok=True)
(_home / ".codex" / "config.toml").write_text("model = \"gpt-5.6-luna\"\nmodel_reasoning_effort = \"low\"\n", encoding="utf-8")
(_home / ".codex" / "auth.json").write_text("{\"auth_mode\": \"chatgpt\"}", encoding="utf-8")
(_home / ".config" / "opencode").mkdir(parents=True, exist_ok=True)
(_home / ".config" / "opencode" / "opencode.json").write_text("{\"model\": \"muse-spark-1.3-contributor\", \"reasoning\": \"medium\", \"provider\": \"opencode-go\"}", encoding="utf-8")
(_home / ".config" / "opencode" / "auth.json").write_text("{\"auth_mode\": \"opencode\"}", encoding="utf-8")
os.environ["HOME"] = str(_home)
os.environ["USERPROFILE"] = str(_home)

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher


CODEX_ENTRY = {
    "id": "codex-luna", "agent": "codex", "model": "gpt-5.6-luna",
    "reasoning": "low", "command": "codex", "identity": "codex",
    "auth_mode": "chatgpt",
}
SPARK_ENTRY = {
    "id": "opencode-spark", "model": "muse-spark-1.3-contributor",
    "reasoning": "medium", "provider": "opencode-go", "command": "opencode",
    "identity": "opencode", "auth_mode": "opencode",
}
POLICY = [dict(CODEX_ENTRY), dict(SPARK_ENTRY)]
ISSUE = {"id": "uuid-70", "identifier": "MAI-70", "title": "Worker work"}
WORKTREE = {"id": "wt-70", "path": "C:/work/MAI-70", "displayName": "MAI-70-work", "linkedLinearIssue": "MAI-70"}


def _config(worker_id):
    return {"allowed_workers": [dict(e) for e in POLICY], "worker_id": worker_id}


def _codex_home(tmp, model="gpt-5.6-luna", reasoning="low", auth_mode="chatgpt", routing=""):
    base = Path(tmp)
    codex = base / ".codex"
    codex.mkdir(parents=True, exist_ok=True)
    extra = "\n" + routing + "\n" if routing else ""
    (codex / "config.toml").write_text(f"model = \"{model}\"\nmodel_reasoning_effort = \"{reasoning}\"\n" + extra, encoding="utf-8")
    (codex / "auth.json").write_text("{\"auth_mode\": \"" + auth_mode + "\"}", encoding="utf-8")
    return base


def _opencode_home(tmp, model="muse-spark-1.3-contributor", reasoning="medium", provider="opencode-go", auth_mode="opencode", with_auth=True):
    base = Path(tmp)
    target = base / ".config" / "opencode"
    target.mkdir(parents=True, exist_ok=True)
    (target / "opencode.json").write_text(
        "{\"model\": \"" + model + "\", \"reasoning\": \"" + reasoning + "\", \"provider\": \"" + provider + "\"}",
        encoding="utf-8",
    )
    if with_auth:
        (target / "auth.json").write_text("{\"auth_mode\": \"" + auth_mode + "\"}", encoding="utf-8")
    return base


def _verbs(calls):
    return [(c.args[0], c.args[1]) for c in calls]


class WorkerSelectionTests(unittest.TestCase):
    def test_selects_codex_worker(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", _config("codex-luna")):
                matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "codex-luna")

    def test_selects_opencode_worker(self):
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d)
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                matched = dispatcher.preflight_model(home=home)
            self.assertEqual(matched["id"], "opencode-spark")

    def test_simultaneous_installs_decided_by_worker_id(self):
        with tempfile.TemporaryDirectory() as d:
            _codex_home(d)
            home = _opencode_home(d)
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                self.assertEqual(dispatcher.preflight_model(home=home)["id"], "opencode-spark")
            with patch.object(dispatcher, "CONFIG", _config("codex-luna")):
                self.assertEqual(dispatcher.preflight_model(home=home)["id"], "codex-luna")

    def test_missing_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", {"worker_id": "codex-luna"}):
                with self.assertRaisesRegex(RuntimeError, "policy missing"):
                    dispatcher.preflight_model(home=home)

    def test_empty_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": [], "worker_id": "codex-luna"}):
                with self.assertRaisesRegex(RuntimeError, "policy empty"):
                    dispatcher.preflight_model(home=home)

    def test_missing_worker_id_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}):
                with self.assertRaisesRegex(RuntimeError, "worker_id missing"):
                    dispatcher.preflight_model(home=home)

    def test_unknown_worker_id_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            with patch.object(dispatcher, "CONFIG", _config("nope-zzz")):
                with self.assertRaisesRegex(RuntimeError, "unknown worker_id"):
                    dispatcher.preflight_model(home=home)

    def test_duplicate_worker_id_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d)
            dup = {"allowed_workers": [dict(CODEX_ENTRY), dict(CODEX_ENTRY)], "worker_id": "codex-luna"}
            with patch.object(dispatcher, "CONFIG", dup):
                with self.assertRaisesRegex(RuntimeError, "duplicate worker_id"):
                    dispatcher.preflight_model(home=home)

    def test_incomplete_entry_rejected(self):
        bad = {"allowed_workers": [{"id": "half", "model": "m"}], "worker_id": "half"}
        with patch.object(dispatcher, "CONFIG", bad):
            with self.assertRaisesRegex(RuntimeError, "missing id/model"):
                dispatcher.selected_worker()


class WorkerDivergenceTests(unittest.TestCase):
    def test_model_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, model="gpt-9-unknown")
            with patch.object(dispatcher, "CONFIG", _config("codex-luna")):
                with self.assertRaisesRegex(RuntimeError, "model mismatch"):
                    dispatcher.preflight_model(home=home)

    def test_reasoning_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d, reasoning="high")
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                with self.assertRaisesRegex(RuntimeError, "reasoning mismatch"):
                    dispatcher.preflight_model(home=home)

    def test_provider_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d, provider="other-provider")
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                with self.assertRaisesRegex(RuntimeError, "provider mismatch"):
                    dispatcher.preflight_model(home=home)

    def test_codex_auth_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, auth_mode="oauth")
            with patch.object(dispatcher, "CONFIG", _config("codex-luna")):
                with self.assertRaisesRegex(RuntimeError, "auth mismatch"):
                    dispatcher.preflight_model(home=home)

    def test_opencode_missing_auth_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d, with_auth=False)
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                with self.assertRaisesRegex(RuntimeError, "auth mismatch"):
                    dispatcher.preflight_model(home=home)

    def test_opencode_wrong_auth_mode_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d, auth_mode="other-mode")
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                with self.assertRaisesRegex(RuntimeError, "auth mismatch"):
                    dispatcher.preflight_model(home=home)

    def test_forbidden_routing_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, routing="model_provider = \"openrouter\"")
            with patch.object(dispatcher, "CONFIG", _config("codex-luna")):
                with self.assertRaisesRegex(RuntimeError, "routing forbidden"):
                    dispatcher.preflight_model(home=home)

    def test_missing_local_config_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                with self.assertRaisesRegex(RuntimeError, "config missing"):
                    dispatcher.preflight_model(home=Path(d))

    def test_errors_never_leak_secrets(self):
        secret = "sk-super-secret-123"
        with tempfile.TemporaryDirectory() as d:
            home = _codex_home(d, model="gpt-9-unknown")
            (home / ".codex" / "auth.json").write_text("{\"auth_mode\": \"chatgpt\", \"token\": \"" + secret + "\"}", encoding="utf-8")
            with patch.object(dispatcher, "CONFIG", _config("codex-luna")):
                with self.assertRaises(RuntimeError) as ctx:
                    dispatcher.preflight_model(home=home)
            message = str(ctx.exception)
            self.assertNotIn(secret, message)
            self.assertNotIn("token", message.lower())
        with tempfile.TemporaryDirectory() as d:
            home = _opencode_home(d, provider="other-provider")
            target = home / ".config" / "opencode"
            (target / "auth.json").write_text("{\"auth_mode\": \"opencode\", \"api_key\": \"" + secret + "\"}", encoding="utf-8")
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
                with self.assertRaises(RuntimeError) as ctx:
                    dispatcher.preflight_model(home=home)
            message = str(ctx.exception)
            self.assertNotIn(secret, message)
            self.assertNotIn("api_key", message.lower())


class WorkerPromptTests(unittest.TestCase):
    def test_codex_prompt_names_worker_only(self):
        with patch.object(dispatcher, "CONFIG", _config("codex-luna")):
            prompt = dispatcher.agent_prompt("MAI-70", dict(CODEX_ENTRY))
        self.assertIn("codex gpt-5.6-luna low", prompt)
        self.assertIn("`codex`", prompt)
        self.assertNotIn("muse-spark", prompt)
        self.assertNotIn("opencode", prompt)
        self.assertNotIn("devem permanecer", prompt)

    def test_spark_prompt_names_worker_only(self):
        with patch.object(dispatcher, "CONFIG", _config("opencode-spark")):
            prompt = dispatcher.agent_prompt("MAI-70", dict(SPARK_ENTRY))
        self.assertIn("opencode-go muse-spark-1.3-contributor medium", prompt)
        self.assertIn("`opencode`", prompt)
        self.assertNotIn("gpt-5.6-luna", prompt)
        self.assertNotIn("devem permanecer", prompt)


class WorkerRouteTests(unittest.TestCase):
    def _route(self, fake, verb, index=0):
        matches = [c for c in fake.call_args_list if len(c.args) >= 2 and (c.args[0], c.args[1]) == verb]
        return matches[index] if len(matches) > index else None

    def test_codex_create_uses_agent_and_prompt(self):
        wt = dict(WORKTREE)
        def fake_orca(*args, **kwargs):
            if args[:2] == ("worktree", "create"):
                return {"worktree": wt}
            if args[:2] == ("terminal", "list"):
                return {"terminals": [{"handle": "h-codex", "agentIdentity": "codex"}]}
            if args[:2] == ("terminal", "read"):
                return {"terminal": {"tail": ["model:       gpt-5.6-luna low"]}}
            raise AssertionError(f"unexpected orca call {args[:3]}")
        with patch.object(dispatcher, "CONFIG", _config("codex-luna")), \
                    patch.object(dispatcher, "orca", side_effect=fake_orca) as fake:
                worktree, handle = dispatcher.create_workspace(ISSUE)
        self.assertEqual(handle, "h-codex")
        create = self._route(fake, ("worktree", "create"))
        self.assertIn("--agent", create.args)
        self.assertIn("codex", create.args)
        prompt_at = create.args.index("--prompt") + 1
        self.assertIn("gpt-5.6-luna low", create.args[prompt_at])
        self.assertNotIn("muse-spark", create.args[prompt_at])
        self.assertFalse(any(c.args[:2] == ("terminal", "create") for c in fake.call_args_list))

    def test_spark_create_omits_agent_and_uses_opencode_command(self):
        wt = dict(WORKTREE)
        def fake_orca(*args, **kwargs):
            if args[:2] == ("worktree", "create"):
                return {"worktree": wt}
            if args[:2] == ("terminal", "create"):
                return {"terminal": {"handle": "h-spark"}}
            if args[:2] == ("terminal", "list"):
                return {"terminals": [{"handle": "h-spark", "agentIdentity": "opencode"}]}
            if args[:2] == ("terminal", "read"):
                return {"terminal": {"tail": ["muse-spark-1.3-contributor medium"]}}
            if args[:2] == ("terminal", "send"):
                return {}
            raise AssertionError(f"unexpected orca call {args[:3]}")
        with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                    patch.object(dispatcher, "orca", side_effect=fake_orca) as fake:
                worktree, handle = dispatcher.create_workspace(ISSUE)
        self.assertEqual(handle, "h-spark")
        create = self._route(fake, ("worktree", "create"))
        self.assertNotIn("--agent", create.args)
        term_create = self._route(fake, ("terminal", "create"))
        self.assertIn("opencode", term_create.args)
        self.assertNotIn("codex", [a for a in term_create.args if isinstance(a, str) and a != "terminal"])
        sends = [c for c in fake.call_args_list if c.args[:2] == ("terminal", "send")]
        self.assertTrue(any("muse-spark-1.3-contributor medium" in str(c) for c in sends))

    def test_spark_recovery_never_creates_codex(self):
        seen = {"created": False}
        def fake_orca(*args, **kwargs):
            if args[:2] == ("terminal", "list"):
                if seen["created"]:
                    return {"terminals": [{"handle": "h-r", "agentIdentity": "opencode"}]}
                return {"terminals": []}
            if args[:2] == ("terminal", "create"):
                seen["created"] = True
                return {"terminal": {"handle": "h-r"}}
            if args[:2] == ("terminal", "read"):
                return {"terminal": {"tail": ["muse-spark-1.3-contributor medium"]}}
            if args[:2] == ("terminal", "send"):
                return {}
            raise AssertionError(f"unexpected orca call {args[:3]}")
        with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                patch.object(dispatcher, "orca", side_effect=fake_orca) as fake:
            handle = dispatcher.recover_existing(ISSUE, WORKTREE, dict(SPARK_ENTRY))
        self.assertEqual(handle, "h-r")
        term_create = self._route(fake, ("terminal", "create"))
        self.assertIn("opencode", term_create.args)
        flat = " ".join(a for c in fake.call_args_list if c.args[:2] == ("terminal", "create") for a in c.args if isinstance(a, str))
        self.assertNotIn("codex", flat)

    def test_wrong_identity_never_compensated_by_tail(self):
        def fake_orca(*args, **kwargs):
            if args[:2] == ("terminal", "list"):
                return {"terminals": [{"handle": "h-x", "agentIdentity": "codex"}]}
            if args[:2] == ("terminal", "read"):
                return {"terminal": {"tail": ["muse-spark-1.3-contributor medium"]}}
            raise AssertionError(f"unexpected orca call {args[:3]}")
        with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                patch.object(dispatcher, "orca", side_effect=fake_orca):
            with self.assertRaises(RuntimeError):
                dispatcher.wait_for_worker("C:/work/MAI-70", dict(SPARK_ENTRY), timeout_seconds=0)

    def test_correct_identity_with_tail_confirms(self):
        def fake_orca(*args, **kwargs):
            if args[:2] == ("terminal", "list"):
                return {"terminals": [{"handle": "h-ok", "agentIdentity": "opencode"}]}
            if args[:2] == ("terminal", "read"):
                return {"terminal": {"tail": ["muse-spark-1.3-contributor medium"]}}
            raise AssertionError(f"unexpected orca call {args[:3]}")
        with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                patch.object(dispatcher, "orca", side_effect=fake_orca):
            handle, _ = dispatcher.wait_for_worker("C:/work/MAI-70", dict(SPARK_ENTRY), timeout_seconds=5)
        self.assertEqual(handle, "h-ok")


class WorkerGuardrailTests(unittest.TestCase):
    def _scope(self):
        return {"team": {"name": dispatcher.TEAM}, "project": {"name": dispatcher.PROJECT}, "state": {"name": "In Progress"}, "labels": []}
    def test_invalid_worker_id_means_zero_creation(self):
        with patch.object(dispatcher, "CONFIG", _config("nope-zzz")), \
                patch.object(dispatcher, "orca") as fake, \
                patch.object(dispatcher, "save_state"), \
                patch.object(dispatcher, "linear_comment"):
            self.assertFalse(dispatcher.dispatch_issue(ISSUE, {"issues": {}}, [], False))
        verbs = _verbs(fake.call_args_list)
        self.assertNotIn(("worktree", "create"), verbs)
        self.assertNotIn(("terminal", "create"), verbs)

    def test_reconcile_invalid_policy_raises_without_linear_writes(self):
        with patch.object(dispatcher, "CONFIG", {"allowed_workers": POLICY}), \
                patch.object(dispatcher, "orca") as fake, \
                patch.object(dispatcher, "save_state"):
            with self.assertRaises(RuntimeError):
                dispatcher.reconcile_dispatches({"issues": {}}, [dict(WORKTREE)])
        fake.assert_not_called()

    def test_reconcile_respects_selected_worker(self):
        responses = [
            {"issue": self._scope()},
            {"terminals": [{"handle": "term-70", "agentIdentity": "opencode"}]},
            {"terminal": {"tail": ["muse-spark-1.3-contributor medium"]}},
        ]
        state = {"issues": {}}
        with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                patch.object(dispatcher, "orca", side_effect=responses), \
                patch.object(dispatcher, "linear_comment") as comment, \
                patch.object(dispatcher, "save_state"):
            dispatcher.reconcile_dispatches(state, [dict(WORKTREE)])
        self.assertEqual(state["issues"]["MAI-70"]["status"], "dispatched")
        body = comment.call_args.args[1]
        self.assertIn("opencode-go muse-spark-1.3-contributor medium", body)
        self.assertNotIn("gpt-5.6-luna", body)

    def test_reconcile_wrong_identity_skips_without_writes(self):
        responses = [
            {"issue": self._scope()},
            {"terminals": [{"handle": "term-70", "agentIdentity": "codex"}]},
        ]
        state = {"issues": {}}
        with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                patch.object(dispatcher, "orca", side_effect=responses) as fake, \
                patch.object(dispatcher, "linear_comment") as comment, \
                patch.object(dispatcher, "save_state"):
            dispatcher.reconcile_dispatches(state, [dict(WORKTREE)])
        self.assertNotEqual(state.get("issues", {}).get("MAI-70", {}).get("status"), "dispatched")
        comment.assert_not_called()
        self.assertEqual(len(fake.call_args_list), 2)


    def test_reconcile_divergent_provider_zero_linear_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            home = str(_opencode_home(d, provider="other-provider"))
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                    patch.dict(os.environ, {"HOME": home, "USERPROFILE": home}), \
                    patch.object(dispatcher, "orca") as fake, \
                    patch.object(dispatcher, "linear_comment") as comment, \
                    patch.object(dispatcher, "save_state") as save:
                state = {"issues": {}}
                with self.assertRaisesRegex(RuntimeError, "provider mismatch"):
                    dispatcher.reconcile_dispatches(state, [dict(WORKTREE)])
            fake.assert_not_called()
            comment.assert_not_called()
            save.assert_not_called()
            self.assertEqual(state, {"issues": {}})

    def test_reconcile_missing_auth_zero_linear_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            home = str(_opencode_home(d, with_auth=False))
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                    patch.dict(os.environ, {"HOME": home, "USERPROFILE": home}), \
                    patch.object(dispatcher, "orca") as fake, \
                    patch.object(dispatcher, "linear_comment") as comment, \
                    patch.object(dispatcher, "save_state") as save:
                state = {"issues": {}}
                with self.assertRaisesRegex(RuntimeError, "auth mismatch"):
                    dispatcher.reconcile_dispatches(state, [dict(WORKTREE)])
            fake.assert_not_called()
            comment.assert_not_called()
            save.assert_not_called()
            self.assertEqual(state, {"issues": {}})

    def test_monitor_divergent_provider_zero_linear_mutation(self):
        wt = dict(WORKTREE)
        wt["branch"] = "feature"
        state = {"issues": {"MAI-70": {"status": "dispatched"}}}
        with tempfile.TemporaryDirectory() as d:
            home = str(_opencode_home(d, provider="other-provider"))
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                    patch.dict(os.environ, {"HOME": home, "USERPROFILE": home}), \
                    patch.object(dispatcher, "orca") as fake, \
                    patch.object(dispatcher, "linear_comment") as comment, \
                    patch.object(dispatcher, "save_state") as save, \
                    patch.object(dispatcher, "gh_pr_for_branch") as gh:
                with self.assertRaisesRegex(RuntimeError, "provider mismatch"):
                    dispatcher.monitor_deliveries(state, [wt])
            fake.assert_not_called()
            comment.assert_not_called()
            save.assert_not_called()
            gh.assert_not_called()

    def test_monitor_missing_auth_zero_linear_mutation(self):
        wt = dict(WORKTREE)
        wt["branch"] = "feature"
        state = {"issues": {"MAI-70": {"status": "dispatched"}}}
        with tempfile.TemporaryDirectory() as d:
            home = str(_opencode_home(d, with_auth=False))
            with patch.object(dispatcher, "CONFIG", _config("opencode-spark")), \
                    patch.dict(os.environ, {"HOME": home, "USERPROFILE": home}), \
                    patch.object(dispatcher, "orca") as fake, \
                    patch.object(dispatcher, "linear_comment") as comment, \
                    patch.object(dispatcher, "save_state") as save, \
                    patch.object(dispatcher, "gh_pr_for_branch") as gh:
                with self.assertRaisesRegex(RuntimeError, "auth mismatch"):
                    dispatcher.monitor_deliveries(state, [wt])
            fake.assert_not_called()
            comment.assert_not_called()
            save.assert_not_called()
            gh.assert_not_called()

if __name__ == "__main__":
    unittest.main()
