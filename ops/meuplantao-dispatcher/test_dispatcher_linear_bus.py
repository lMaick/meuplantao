import json
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

POLICY_TOML = (
    "[[allowed_workers]]\n"
    "id = \"codex-luna\"\n"
    "agent = \"codex\"\n"
    "model = \"gpt-5.6-luna\"\n"
    "reasoning = \"low\"\n"
    "command = \"codex\"\n"
    "identity = \"codex\"\n"
    "auth_mode = \"chatgpt\"\n"
    "worker_id = \"codex-luna\"\n"
)

import os
_fixture = Path(tempfile.gettempdir()) / "mai69-linear-bus-config-v2.toml"
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
    + POLICY_TOML,
    encoding="utf-8",
)
os.environ["MEUPLANTAO_DISPATCHER_CONFIG"] = str(_fixture)

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher

POLICY_ENTRY = {
    "id": "codex-luna", "agent": "codex", "model": "gpt-5.6-luna",
    "reasoning": "low", "command": "codex", "identity": "codex",
    "auth_mode": "chatgpt",
}

ISSUE = {"id": "uuid-69", "identifier": "MAI-69", "title": "Linear bus"}
WORKTREE = {"id": "wt-69", "path": "C:/work/MAI-69", "displayName": "MAI-69-work", "linkedLinearIssue": "MAI-69"}


def _linear_issue(state_name="Todo", labels=(), team="Team", project=None, comments=()):
    pname = project if project is not None else dispatcher.PROJECT
    payload = {"team": {"name": team}, "project": {"name": pname},
               "state": {"name": state_name},
               "labels": [{"name": name} for name in labels]}
    if comments:
        payload["comments"] = [{"body": body} for body in comments]
    return {"issue": payload}


def _hermes_bodies(comment_mock):
    return [c.args[1] for c in comment_mock.call_args_list
            if "fluxo padrao" in c.args[1]]


class LinearBusTests(unittest.TestCase):
    def test_no_global_config_mutation_at_import(self):
        lines = Path(__file__).read_text(encoding="utf-8").splitlines()
        code = [line for line in lines if "assert" not in line]
        blob = "\n".join(code)
        self.assertNotIn("CONFIG.setdefault", blob)
        self.assertNotIn("CONFIG.update", blob)
        self.assertIn("[[allowed_workers]]", blob)

    def test_claim_persists_dispatch_id_before_side_effect(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "create_workspace", return_value=(WORKTREE, "term-69")), \
             patch.object(dispatcher, "sync_started"), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.dispatch_issue(ISSUE, state, [], False))
        entry = state["issues"]["MAI-69"]
        self.assertIn("dispatchId", entry)
        self.assertTrue(entry["dispatchId"])
        self.assertEqual(entry["status"], "dispatched")

    def test_second_tick_does_not_duplicate_worktree_or_agent(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "create_workspace", return_value=(WORKTREE, "term-69")), \
             patch.object(dispatcher, "sync_started"), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.dispatch_issue(ISSUE, state, [], False))
        with patch.object(dispatcher, "create_workspace") as create2, \
             patch.object(dispatcher, "recover_existing") as recover, \
             patch.object(dispatcher, "sync_started") as sync2, \
             patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [WORKTREE], False))
        create2.assert_not_called()
        recover.assert_not_called()
        sync2.assert_not_called()

    def test_ambiguous_failure_is_sanitized_and_never_auto_retries(self):
        state = {"issues": {}}
        evil = "orca boom ghp_0123456789abcdef0123456789abcdef0123 password=hunter2"
        with patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "create_workspace", side_effect=RuntimeError(evil)), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [], False))
        self.assertIn(state["issues"]["MAI-69"]["status"], ("dispatching", "dispatch-timeout"))
        self.assertIn("dispatchId", state["issues"]["MAI-69"])
        body = comment.call_args.args[1]
        self.assertNotIn("ghp_0123456789abcdef0123456789abcdef0123", body)
        self.assertNotIn("hunter2", body)
        self.assertIn("[redacted]", body)
        stored = state["issues"]["MAI-69"].get("ambiguousError", "")
        self.assertNotIn("ghp_0123456789abcdef0123456789abcdef0123", stored)
        with patch.object(dispatcher, "create_workspace") as create2, \
             patch.object(dispatcher, "recover_existing") as recover, \
             patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [], False))
        create2.assert_not_called()
        recover.assert_not_called()

    def test_sanitize_removes_known_secret_shapes(self):
        evil = ("token ghp_0123456789abcdef0123456789abcdef0123 and sk-ant-abcdefgh1234 "
                "and AKIAIOSFODNN7EXAMPLE api_key=deadbeef "
                "-----BEGIN RSA PRIVATE KEY----- MIIE -----END RSA PRIVATE KEY----- "
                "Bearer abc.def.ghi password = s3cr3t")
        clean = dispatcher.sanitize_for_linear(evil)
        for secret in ("ghp_0123456789abcdef0123456789abcdef0123", "sk-ant-abcdefgh1234",
                       "AKIAIOSFODNN7EXAMPLE", "deadbeef", "MIIE", "abc.def.ghi", "s3cr3t"):
            self.assertNotIn(secret, clean)
        self.assertIn("[redacted]", clean)
        plain = dispatcher.sanitize_for_linear("Dispatch concluido para MAI-69 sem erros.")
        self.assertEqual(plain, "Dispatch concluido para MAI-69 sem erros.")

    def test_emit_posts_linear_comment_and_records_only_after_success(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.emit_hermes_event("MAI-69", "needs-review", "MAI-69:needs-review:x", state))
        bodies = _hermes_bodies(comment)
        self.assertEqual(len(bodies), 1)
        self.assertEqual(bodies[0], dispatcher.hermes_prompt("MAI-69", "needs-review"))
        with patch.object(dispatcher, "linear_comment") as retry, \
             patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.emit_hermes_event("MAI-69", "needs-review", "MAI-69:needs-review:x", state))
        retry.assert_not_called()

    def test_emit_failure_records_nothing_and_retry_delivers_once(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "linear_comment", side_effect=RuntimeError("disk down")) as comment, \
             patch.object(dispatcher, "save_state"):
            with self.assertRaises(RuntimeError):
                dispatcher.emit_hermes_event("MAI-69", "blocked", "MAI-69:blocked", state)
        self.assertNotIn("MAI-69:blocked", state["issues"]["MAI-69"].get("hermesNotified", {}))
        with patch.object(dispatcher, "linear_comment") as retry, \
             patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.emit_hermes_event("MAI-69", "blocked", "MAI-69:blocked", state))
            self.assertFalse(dispatcher.emit_hermes_event("MAI-69", "blocked", "MAI-69:blocked", state))
        self.assertEqual(len(_hermes_bodies(retry)), 1)

    def test_hermes_payload_is_strictly_issue_and_event(self):
        prompt = dispatcher.hermes_prompt("MAI-69", "dispatch-timeout")
        self.assertIn("MAI-69", prompt)
        self.assertIn("dispatch-timeout", prompt)
        self.assertNotIn("https://", prompt)
        self.assertNotIn("sha", prompt.lower())
        self.assertNotIn("fingerprint", prompt.lower())
        self.assertNotIn("token", prompt.lower())

    def test_linear_report_drives_review_without_github_discovery(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=abc1234 tests=12 ok"]
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://example.test/pr/44",
              "statusCheckRollup": []}
        with patch.object(dispatcher, "orca", return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_url", return_value=pr) as verify, \
             patch.object(dispatcher, "gh_pr_for_branch") as branch_gh:
            dispatcher.poll_linear_outcomes(state)
        verify.assert_called_once_with("https://example.test/pr/44")
        branch_gh.assert_not_called()
        self.assertEqual(state["issues"]["MAI-69"]["status"], "needs-review")
        self.assertEqual(state["issues"]["MAI-69"]["reviewMarker"], "44:abc1234")

    def test_linear_error_report_is_sanitized(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: error tests failed token=ghp_0123456789abcdef0123456789abcdef0123"]
        with patch.object(dispatcher, "orca", return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_branch") as branch_gh:
            dispatcher.poll_linear_outcomes(state)
        branch_gh.assert_not_called()
        self.assertEqual(state["issues"]["MAI-69"]["status"], "error")
        bodies = " ".join(c.args[1] for c in comment.call_args_list)
        self.assertNotIn("ghp_0123456789abcdef0123456789abcdef0123", bodies)
        self.assertNotIn("ghp_0123456789abcdef0123456789abcdef0123",
                         json.dumps(state["issues"]["MAI-69"]))

    def test_needs_review_notifies_hermes_exactly_once_per_fingerprint(self):
        state = {"issues": {}}
        pr = {"number": 41, "headRefOid": "sha-1", "url": "https://example.test/pr/41",
              "statusCheckRollup": []}
        with patch.object(dispatcher, "orca"), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-69", pr, state)
            dispatcher.deliver_hermes_notifications(state)
            self.assertEqual(len(_hermes_bodies(comment)), 1)
            dispatcher.mark_for_review("MAI-69", pr, state)
            dispatcher.deliver_hermes_notifications(state)
            self.assertEqual(len(_hermes_bodies(comment)), 1)

    def test_new_sha_resets_hermes_fingerprint(self):
        state = {"issues": {}}
        pr1 = {"number": 42, "headRefOid": "sha-old", "url": "https://example.test/pr/42",
               "statusCheckRollup": []}
        pr2 = {"number": 42, "headRefOid": "sha-new", "url": "https://example.test/pr/42",
               "statusCheckRollup": []}
        with patch.object(dispatcher, "orca"), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-69", pr1, state)
            dispatcher.deliver_hermes_notifications(state)
            dispatcher.mark_for_review("MAI-69", pr2, state)
            dispatcher.deliver_hermes_notifications(state)
        self.assertEqual(len(_hermes_bodies(comment)), 2)
        self.assertEqual(state["issues"]["MAI-69"]["reviewMarker"], "42:sha-new")

    def test_blocked_notifies_hermes_exactly_once(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        with patch.object(dispatcher, "orca", return_value=_linear_issue("Blocked", [])), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            dispatcher.poll_linear_outcomes(state)
            dispatcher.poll_linear_outcomes(state)
        self.assertEqual(len(_hermes_bodies(comment)), 1)

    def test_dispatch_timeout_marks_linear_and_notifies_once(self):
        state = {"issues": {"MAI-69": {"status": "dispatching", "dispatchId": "d-1",
                                       "claimedAt": 1000}}}
        with patch.object(dispatcher, "orca", return_value=_linear_issue("Todo", ["Orca Ready"])), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "create_workspace") as create, \
             patch.object(dispatcher, "DISPATCH_TIMEOUT_SECONDS", 60):
            dispatcher.poll_linear_outcomes(state, now=2000)
            dispatcher.poll_linear_outcomes(state, now=2000)
        self.assertEqual(state["issues"]["MAI-69"]["status"], "dispatch-timeout")
        calls = [c.args for c in comment.call_args_list]
        timeout_notes = [b for (_, b) in calls if "timeout" in b.lower()]
        self.assertTrue(timeout_notes)
        self.assertEqual(len(_hermes_bodies(comment)), 1)
        create.assert_not_called()

    def test_linear_result_advances_without_terminal_consult(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1",
                                       "workspacePath": WORKTREE["path"]}}}
        with patch.object(dispatcher, "orca", return_value=_linear_issue("In Progress", [])) as fake_orca, \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            dispatcher.poll_linear_outcomes(state)
        terminal_calls = [c for c in fake_orca.call_args_list if len(c.args) >= 2 and c.args[0] == "terminal"]
        self.assertEqual(terminal_calls, [])

    def test_no_llm_call_in_polling_and_coordination(self):
        source = Path(dispatcher.__file__).read_text(encoding="utf-8").lower()
        for token in ("import openai", "import anthropic", "chat.completions",
                      "responses.create", "llm_client", "openai.api_key"):
            self.assertNotIn(token, source)
        self.assertIn("_secret_patterns", source)
        self.assertIn("def poll_linear_outcomes", source)
        self.assertIn("def emit_hermes_event", source)
        self.assertIn("def sync_worker_reports", source)
        self.assertIn("def deliver_hermes_notifications", source)

    def test_missing_policy_means_zero_creation_and_sanitized_error(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "allowed_workers", side_effect=RuntimeError("preflight: worker policy missing")), \
             patch.object(dispatcher, "create_workspace") as create, \
             patch.object(dispatcher, "sync_started") as sync, \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.dispatch_issue(
                {"identifier": "MAI-69", "title": "t"}, state, [], False))
        create.assert_not_called()
        sync.assert_not_called()
        self.assertEqual(state["issues"]["MAI-69"]["status"], "error")
        if comment.called:
            body = comment.call_args.args[1]
            self.assertNotIn("chatgpt", body.lower())
            self.assertNotIn("token", body.lower())


    def test_divergent_report_never_promotes_across_two_cycles(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=deadbeef tests=ok"]
        reported = {"number": 44, "headRefOid": "abc1234", "url": "https://example.test/pr/44",
                    "statusCheckRollup": []}
        branch_pr = {"number": 44, "headRefOid": "abc1234", "url": "https://example.test/pr/44",
                     "statusCheckRollup": []}
        with patch.object(dispatcher, "orca", return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_url", return_value=reported), \
             patch.object(dispatcher, "gh_pr_for_branch", return_value=branch_pr):
            dispatcher.poll_linear_outcomes(state)
            self.assertEqual(state["issues"]["MAI-69"].get("status"), "dispatched")
            self.assertNotIn("reviewMarker", state["issues"]["MAI-69"])
            stored = state["issues"]["MAI-69"].get("workerReport") or {}
            self.assertNotEqual(stored.get("sha"), "deadbeef")
            wt = dict(WORKTREE, branch="lMaick/MAI-69-x")
            with patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)):
                dispatcher.monitor_deliveries(state, [wt])
            self.assertEqual(state["issues"]["MAI-69"].get("status"), "dispatched")
            self.assertNotIn("reviewMarker", state["issues"]["MAI-69"])

    def test_timeout_label_failure_retries_and_finalizes_only_after_confirm(self):
        state = {"issues": {"MAI-69": {"status": "dispatching", "dispatchId": "d-1",
                                       "claimedAt": 1000}}}
        calls = {"label": 0}

        def fake_orca(*args, **kwargs):
            if len(args) >= 2 and args[0] == "linear" and args[1] == "label":
                calls["label"] += 1
                if calls["label"] == 1:
                    raise RuntimeError("label boom password=hunter2")
                return {}
            if len(args) >= 2 and args[0] == "linear" and args[1] == "issue":
                return _linear_issue("Todo", ["Orca Ready"])
            return {}

        with patch.object(dispatcher, "orca", side_effect=fake_orca), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            with self.assertRaises(RuntimeError):
                dispatcher.mark_dispatch_timeout("MAI-69", state, now=2000)
            self.assertNotEqual(state["issues"]["MAI-69"].get("status"), "dispatch-timeout")
            stages = state["issues"]["MAI-69"].get("timeoutStages", {})
            self.assertNotIn("hunter2", json.dumps(stages))
            self.assertTrue(dispatcher.mark_dispatch_timeout("MAI-69", state, now=2000))
            self.assertEqual(state["issues"]["MAI-69"].get("status"), "dispatch-timeout")
        self.assertEqual(calls["label"], 2)

    def test_timeout_comment_failure_retries_and_finalizes_only_after_confirm(self):
        state = {"issues": {"MAI-69": {"status": "dispatching", "dispatchId": "d-1",
                                       "claimedAt": 1000}}}
        with patch.object(dispatcher, "orca", return_value={}), \
             patch.object(dispatcher, "linear_comment",
                          side_effect=[RuntimeError("comment down token=ghp_0123456789abcdef0123456789abcdef0123"), None]) as comment, \
             patch.object(dispatcher, "save_state"):
            with self.assertRaises(RuntimeError):
                dispatcher.mark_dispatch_timeout("MAI-69", state, now=2000)
            self.assertNotEqual(state["issues"]["MAI-69"].get("status"), "dispatch-timeout")
            bodies = json.dumps(state["issues"]["MAI-69"])
            self.assertNotIn("ghp_0123456789abcdef0123456789abcdef0123", bodies)
            self.assertTrue(dispatcher.mark_dispatch_timeout("MAI-69", state, now=2000))
            self.assertEqual(state["issues"]["MAI-69"].get("status"), "dispatch-timeout")
            self.assertEqual(comment.call_count, 2)

    def test_sensitive_exceptions_never_reach_persistent_logs(self):
        evil = "boom ghp_0123456789abcdef0123456789abcdef0123 password=hunter2"
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "create_workspace", side_effect=RuntimeError(evil)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            with self.assertLogs(dispatcher.LOG, level="INFO") as captured:
                self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [], False))
        blob = "\n".join(captured.output)
        self.assertNotIn("ghp_0123456789abcdef0123456789abcdef0123", blob)
        self.assertNotIn("hunter2", blob)


if __name__ == "__main__":
    unittest.main()
