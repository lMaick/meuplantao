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


    def test_main_processes_linear_delivery_with_invalid_preflight_and_no_terminal(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=abc1234 tests=12 ok"]
        payload = _linear_issue("In Progress", [], comments=comments)
        calls = []
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://example.test/pr/44",
              "statusCheckRollup": []}
        with patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "gh_pr_for_url", return_value=pr):
            _run_main(state, _main_orca(payload, calls))
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "needs-review")
        self.assertEqual(state["issues"]["MAI-69"].get("reviewMarker"), "44:abc1234")
        self.assertEqual(len(_hermes_bodies(comment)), 1)
        self.assertEqual([c for c in calls if c and c[0] == "terminal"], [])

    def test_main_processes_linear_error_with_invalid_preflight(self):
        evil = "ghp_0123456789abcdef0123456789abcdef0123 password=hunter2"
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: error tests failed token=" + evil]
        payload = _linear_issue("In Progress", [], comments=comments)
        calls = []
        with patch.object(dispatcher, "linear_comment") as comment:
            _run_main(state, _main_orca(payload, calls))
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "error")
        bodies = " ".join(c.args[1] for c in comment.call_args_list)
        self.assertNotIn("ghp_0123456789abcdef0123456789abcdef0123", bodies)
        self.assertNotIn("hunter2", bodies)
        self.assertNotIn("hunter2", json.dumps(state["issues"]["MAI-69"]))
        self.assertEqual([c for c in calls if c and c[0] == "terminal"], [])

    def test_main_processes_linear_blocked_with_invalid_preflight(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        payload = _linear_issue("Blocked", [])
        calls = []
        with patch.object(dispatcher, "linear_comment") as comment:
            _run_main(state, _main_orca(payload, calls))
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "blocked")
        self.assertEqual(len(_hermes_bodies(comment)), 1)
        self.assertEqual([c for c in calls if c and c[0] == "terminal"], [])

    def test_monitor_keeps_preflight_fail_closed(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1",
                                       "workerReport": {"kind": "delivery",
                                                        "pr": "https://example.test/pr/44",
                                                        "sha": "abc1234", "tests": "ok",
                                                        "number": 44, "head": "abc1234"}}}}
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://example.test/pr/44",
              "statusCheckRollup": []}
        wt = dict(WORKTREE, branch="lMaick/MAI-69-x")
        with patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("preflight: gone")), \
             patch.object(dispatcher, "orca") as fake, \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state") as save, \
             patch.object(dispatcher, "gh_pr_for_branch") as branch_gh:
            with self.assertRaisesRegex(RuntimeError, "preflight"):
                dispatcher.monitor_deliveries(state, [wt])
        fake.assert_not_called()
        comment.assert_not_called()
        save.assert_not_called()
        branch_gh.assert_not_called()
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "dispatched")

    def test_hermes_ack_quiets_precheck(self):
        fp = dispatcher.hermes_fingerprint("MAI-69", "needs-review", "44:abc1234")
        state = {"issues": {"MAI-69": {"status": "needs-review", "reviewMarker": "44:abc1234",
                                       "hermesNotified": {fp: {"at": 1, "event": "needs-review"}}}}}
        acked = _linear_issue("In Progress", [], comments=["obrigado", "MeuPlantao-Ack: " + fp])
        with patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("preflight: gone")), \
             patch.object(dispatcher, "orca", side_effect=_main_orca(acked)):
            events, code = dispatcher.hermes_precheck(state)
        self.assertEqual(events, [])
        self.assertEqual(code, 1)
        bare = _linear_issue("In Progress", [], comments=["sem ack aqui"])
        with patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("preflight: gone")), \
             patch.object(dispatcher, "orca", side_effect=_main_orca(bare)):
            events, code = dispatcher.hermes_precheck(state)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["fingerprint"], fp)
        self.assertEqual(events[0]["event"], "needs-review")
        self.assertEqual(code, 0)

    def test_precheck_unreachable_linear_is_fail_closed_pending(self):
        state = {"issues": {"MAI-69": {"status": "blocked", "dispatchId": "d-1"}}}
        def down(*args, **kwargs):
            raise RuntimeError("linear down")
        with patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("preflight: gone")), \
             patch.object(dispatcher, "orca", side_effect=down):
            events, code = dispatcher.hermes_precheck(state)
        self.assertEqual(len(events), 1)
        self.assertFalse(events[0]["linearReachable"])
        self.assertEqual(code, 0)

    def test_failed_emit_stays_precheck_pending(self):
        fp = dispatcher.hermes_fingerprint("MAI-69", "needs-review", "44:abc1234")
        state = {"issues": {"MAI-69": {"status": "needs-review", "reviewMarker": "44:abc1234"}}}
        with patch.object(dispatcher, "linear_comment", side_effect=RuntimeError("post down")), \
             patch.object(dispatcher, "save_state"):
            with self.assertRaises(RuntimeError):
                dispatcher.emit_hermes_event("MAI-69", "needs-review", fp, state)
        self.assertNotIn(fp, state["issues"]["MAI-69"].get("hermesNotified", {}))
        with patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("preflight: gone")), \
             patch.object(dispatcher, "orca", side_effect=_main_orca(_linear_issue("In Progress", []))):
            events, code = dispatcher.hermes_precheck(state)
        self.assertEqual([e["fingerprint"] for e in events], [fp])
        self.assertEqual(code, 0)

    def test_hermes_precheck_mode_is_read_only(self):
        fp = dispatcher.hermes_fingerprint("MAI-69", "blocked")
        state = {"issues": {"MAI-69": {"status": "blocked", "dispatchId": "d-1",
                                       "hermesNotified": {fp: {"at": 1, "event": "blocked"}}}}}
        with patch.object(dispatcher, "acquire_lock") as lock, \
             patch.object(dispatcher, "load_state", return_value=state), \
             patch.object(dispatcher, "save_state") as save, \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "orca", side_effect=_main_orca(_linear_issue("Blocked", []))), \
             patch.object(sys, "argv", ["dispatcher.py", "--hermes-precheck"]):
            code = dispatcher.main()
        self.assertEqual(code, 0)
        lock.assert_not_called()
        save.assert_not_called()
        comment.assert_not_called()

    def test_hermes_transport_contract_symbols(self):
        source = Path(dispatcher.__file__).read_text(encoding="utf-8")
        for symbol in ("def hermes_precheck", "def unacked_hermes_events",
                       "def hermes_acknowledged", "MeuPlantao-Ack:", "--hermes-precheck"):
            self.assertIn(symbol, source)

    def test_crash_between_post_and_save_does_not_duplicate(self):
        fp = dispatcher.hermes_fingerprint("MAI-69", "needs-review", "44:abc1234")
        state = {"issues": {"MAI-69": {"status": "needs-review", "reviewMarker": "44:abc1234"}}}
        remote = []

        def fake_orca(*args, **kwargs):
            if len(args) >= 2 and args[0] == "linear" and args[1] == "issue":
                return _linear_issue("In Progress", [], comments=list(remote))
            return {}

        def post(issue_id, body, *a, **k):
            remote.append(body)

        saves = {"n": 0}

        def save_crash_once(s):
            saves["n"] += 1
            if saves["n"] == 1:
                raise RuntimeError("disk down after remote accept")

        with patch.object(dispatcher, "orca", side_effect=fake_orca), \
             patch.object(dispatcher, "linear_comment", side_effect=post), \
             patch.object(dispatcher, "save_state", side_effect=save_crash_once):
            dispatcher.deliver_hermes_notifications(state)
        state["issues"]["MAI-69"].pop("hermesNotified", None)
        self.assertNotIn(fp, state["issues"]["MAI-69"].get("hermesNotified", {}))
        with patch.object(dispatcher, "orca", side_effect=fake_orca), \
             patch.object(dispatcher, "linear_comment", side_effect=post) as posted, \
             patch.object(dispatcher, "save_state"):
            count = dispatcher.deliver_hermes_notifications(state)
        self.assertEqual(posted.call_count, 0)
        self.assertIn(fp, state["issues"]["MAI-69"].get("hermesNotified", {}))
        self.assertEqual(count, 1)

    def test_remote_body_reconciles_without_post(self):
        body = dispatcher.hermes_prompt("MAI-69", "blocked")
        fp = dispatcher.hermes_fingerprint("MAI-69", "blocked")
        state = {"issues": {"MAI-69": {"status": "blocked", "dispatchId": "d-1"}}}
        with patch.object(dispatcher, "orca", return_value=_linear_issue("Blocked", [], comments=[body])), \
             patch.object(dispatcher, "linear_comment") as posted, \
             patch.object(dispatcher, "save_state"):
            count = dispatcher.deliver_hermes_notifications(state)
        posted.assert_not_called()
        self.assertIn(fp, state["issues"]["MAI-69"].get("hermesNotified", {}))
        self.assertEqual(count, 1)

    def test_sanitize_covers_compound_env_names(self):
        evil = ("ctx OPENAI_API_KEY=sk-synth-0123456789abcdef "
                "SUPABASE_SERVICE_ROLE_KEY=eyJzdXBlcmZha2U access_token=tok-synth-abc")
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            clean = fn(evil)
            for secret in ("sk-synth-0123456789abcdef", "eyJzdXBlcmZha2U", "tok-synth-abc",
                           "OPENAI_API_KEY=sk", "SERVICE_ROLE_KEY=eyJ", "access_token=tok"):
                self.assertNotIn(secret, clean)
            self.assertIn("[redacted]", clean)

    def test_hermes_payload_is_strict_json_issue_event(self):
        prompt = dispatcher.hermes_prompt("MAI-69", "needs-review")
        payload = dispatcher.parse_hermes_payload(prompt)
        self.assertIsNotNone(payload)
        self.assertEqual(set(payload.keys()), {"issue", "event"})
        self.assertEqual(payload, {"issue": "MAI-69", "event": "needs-review"})
        self.assertIsNone(dispatcher.parse_hermes_payload("sem bloco json aqui"))
        self.assertIsNone(dispatcher.parse_hermes_payload("```json\n{\"issue\":\"MAI-69\"}\n```"))

    def test_timeout_ack_derivable_from_linear_notice(self):
        state = {"issues": {"MAI-69": {"status": "dispatching", "dispatchId": "d-7",
                                       "claimedAt": 1000}}}
        with patch.object(dispatcher, "orca", return_value={}), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "DISPATCH_TIMEOUT_SECONDS", 60):
            dispatcher.mark_dispatch_timeout("MAI-69", state, now=2000)
        notice = comment.call_args.args[1]
        derived = dispatcher.expected_hermes_ack("MAI-69", "dispatch-timeout", [notice])
        fp = dispatcher.hermes_fingerprint("MAI-69", "dispatch-timeout", "d-7")
        self.assertEqual(derived, fp)
        self.assertTrue(dispatcher.hermes_acknowledged(["MeuPlantao-Ack: " + derived], fp))

    def test_review_ack_derivable_from_linear_review_comment(self):
        state = {"issues": {}}
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://example.test/pr/44",
              "statusCheckRollup": []}
        with patch.object(dispatcher, "orca", return_value={}), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-69", pr, state)
        bodies = [c.args[1] for c in comment.call_args_list]
        derived = dispatcher.expected_hermes_ack("MAI-69", "needs-review", bodies)
        self.assertEqual(derived, "MAI-69:needs-review:44:abc1234")

    def test_precheck_reports_expected_ack(self):
        fp = dispatcher.hermes_fingerprint("MAI-69", "needs-review", "44:abc1234")
        state = {"issues": {"MAI-69": {"status": "needs-review", "reviewMarker": "44:abc1234"}}}
        review = "Entrega detectada automaticamente: PR #44 https://example.test/pr/44 no SHA `abc1234`."
        with patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("preflight: gone")), \
             patch.object(dispatcher, "orca", side_effect=_main_orca(_linear_issue("In Progress", [], comments=[review]))):
            events, code = dispatcher.hermes_precheck(state)
        self.assertEqual(code, 0)
        self.assertEqual(events[0]["expectedAck"], fp)


class _NoopLock:
    def seek(self, *a):
        return None
    def fileno(self):
        return 0
    def close(self):
        return None


def _main_orca(issue_payload=None, calls=None):
    def fake(*args, **kwargs):
        if calls is not None:
            calls.append(args)
        if args and args[0] == "terminal":
            raise AssertionError("outcome path must not consult terminals")
        if args[:1] == ("status",):
            return {"runtime": {"reachable": True}}
        if len(args) >= 2 and args[0] == "linear" and args[1] == "issue":
            if issue_payload is not None:
                return issue_payload
            return _linear_issue("In Progress", [])
        return {}
    return fake


def _run_main(state, orca_fake, argv=("dispatcher.py",)):
    with patch.object(dispatcher, "acquire_lock", return_value=_NoopLock()), \
         patch.object(dispatcher.msvcrt, "locking"), \
         patch.object(dispatcher, "load_state", return_value=state), \
         patch.object(dispatcher, "get_control_mode", return_value="AUTO"), \
         patch.object(dispatcher, "orca", side_effect=orca_fake), \
         patch.object(dispatcher, "list_worktrees", return_value=[]), \
         patch.object(dispatcher, "list_eligible_issues", return_value=[]), \
         patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("preflight: worker config missing")), \
         patch.object(dispatcher, "save_state"), \
         patch.object(sys, "argv", list(argv)):
        return dispatcher.main()

if __name__ == "__main__":
    unittest.main()
