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


def _encode_layers(value, layers):
    from urllib.parse import quote
    current = value
    for _ in range(layers):
        current = quote(current, safe="")
    return current


def _decode_all(value):
    from urllib.parse import unquote
    current = str(value)
    while True:
        decoded = unquote(current)
        if decoded == current:
            return decoded
        current = decoded


def _capture_log_records():
    import logging
    records = []

    class _H(logging.Handler):
        def emit(self, record):
            records.append(record)
    return records, _H()


def _run_sync_capture_logs(state):
    records, handler = _capture_log_records()
    dispatcher.LOG.addHandler(handler)
    try:
        dispatcher.sync_worker_reports(state)
    finally:
        dispatcher.LOG.removeHandler(handler)
    return "\n".join(record.getMessage() for record in records)


CANON_PR_44 = "https://github.com/example/repository/pull/44"


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
        self.assertEqual(bodies[0], dispatcher.hermes_prompt("MAI-69", "needs-review", "MAI-69:needs-review:x"))
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
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://github.com/example/repository/pull/44",
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
        pr = {"number": 41, "headRefOid": "sha-1", "url": "https://github.com/example/repository/pull/41",
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
        pr1 = {"number": 42, "headRefOid": "sha-old", "url": "https://github.com/example/repository/pull/42",
               "statusCheckRollup": []}
        pr2 = {"number": 42, "headRefOid": "sha-new", "url": "https://github.com/example/repository/pull/42",
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
        reported = {"number": 44, "headRefOid": "abc1234", "url": "https://github.com/example/repository/pull/44",
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
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://github.com/example/repository/pull/44",
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
        body = dispatcher.hermes_prompt("MAI-69", "blocked", dispatcher.hermes_fingerprint("MAI-69", "blocked"))
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
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://github.com/example/repository/pull/44",
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

    def test_new_sha_event_posts_despite_older_remote_comment(self):
        old_fp = dispatcher.hermes_fingerprint("MAI-69", "needs-review", "43:aaa1111")
        new_fp = dispatcher.hermes_fingerprint("MAI-69", "needs-review", "44:abc1234")
        old_body = dispatcher.hermes_prompt("MAI-69", "needs-review", old_fp)
        state = {"issues": {"MAI-69": {"status": "needs-review", "reviewMarker": "44:abc1234"}}}
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=[old_body])), \
             patch.object(dispatcher, "linear_comment") as posted, \
             patch.object(dispatcher, "save_state"):
            count = dispatcher.deliver_hermes_notifications(state)
        self.assertEqual(posted.call_count, 1)
        self.assertIn(new_fp, state["issues"]["MAI-69"].get("hermesNotified", {}))
        self.assertNotIn(old_fp, state["issues"]["MAI-69"].get("hermesNotified", {}))
        self.assertEqual(count, 1)

    def test_same_fingerprint_marker_reconciles_without_repost(self):
        fp = dispatcher.hermes_fingerprint("MAI-69", "blocked")
        body = dispatcher.hermes_prompt("MAI-69", "blocked", fp)
        state = {"issues": {"MAI-69": {"status": "blocked", "dispatchId": "d-1"}}}
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("Blocked", [], comments=[body])), \
             patch.object(dispatcher, "linear_comment") as posted, \
             patch.object(dispatcher, "save_state"):
            count = dispatcher.deliver_hermes_notifications(state)
        posted.assert_not_called()
        self.assertIn(fp, state["issues"]["MAI-69"].get("hermesNotified", {}))
        self.assertEqual(count, 1)

    def test_event_comment_marker_keeps_json_strict(self):
        fp = dispatcher.hermes_fingerprint("MAI-69", "needs-review", "44:abc1234")
        prompt = dispatcher.hermes_prompt("MAI-69", "needs-review", fp)
        self.assertEqual(dispatcher.parse_hermes_payload(prompt),
                         {"issue": "MAI-69", "event": "needs-review"})

    def test_expected_ack_prefers_current_review_over_history(self):
        old = "Entrega detectada: PR #43 https://example.test/pr/43 no SHA `aaa1111`."
        new = "Entrega detectada: PR #44 https://example.test/pr/44 no SHA `abc1234`."
        derived = dispatcher.expected_hermes_ack("MAI-69", "needs-review", [old, new], "44:abc1234")
        self.assertEqual(derived, "MAI-69:needs-review:44:abc1234")

    def test_expected_ack_prefers_current_timeout_over_history(self):
        bodies = ["Timeout dispatch `d-6` expirado.", "Timeout dispatch `d-7` expirado."]
        derived = dispatcher.expected_hermes_ack("MAI-69", "dispatch-timeout", bodies, "d-7")
        self.assertEqual(derived,
                         dispatcher.hermes_fingerprint("MAI-69", "dispatch-timeout", "d-7"))

    def test_sanitize_covers_real_credential_shapes(self):
        evil = ("Authorization: Bearer tok-live-abc123 "
                "authorization: bearer tok-live-def456 "
                "AUTHORIZATION = \"Bearer tok with space\" "
                "password=\"hunter 2\" passwd='x y' "
                "postgres://deploy:s3cret@db.host:5432/app "
                "https://user:p4ss@hooks.example.test/hook")
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            clean = fn(evil)
            for secret in ("tok-live-abc123", "tok-live-def456", "tok with space",
                           "hunter 2", "x y", "s3cret", "p4ss",
                           "deploy:s3cret", "user:p4ss"):
                self.assertNotIn(secret, clean)
            self.assertIn("[redacted]", clean)

    def test_hermes_payload_rejects_extra_key(self):
        head = "Leia a MAI-69 no Linear e processe conforme o fluxo padrao. (evento=needs-review)\n"
        extra = head + "```json\n{\"issue\":\"MAI-69\",\"event\":\"needs-review\",\"fingerprint\":\"x\"}\n```"
        self.assertIsNone(dispatcher.parse_hermes_payload(extra))
        stamped = head + "```json\n{\"issue\":\"MAI-69\",\"event\":\"needs-review\",\"at\":123}\n```"
        self.assertIsNone(dispatcher.parse_hermes_payload(stamped))

    def test_delivery_report_persists_only_canonical_sanitized(self):
        raw_url = "https://bot:s3cret@example.test/pr/44?utm=evil&token=zzz#frag"
        tests = ("Bearer live-tok-AAA111 OPENAI_API_KEY=sk-m7 secret=\"q 1\" "
                 "%42earer pctok-999 postgres://u:pw-m7@db/x "
                 "-----BEGIN RSA PRIVATE KEY----- M7 -----END RSA PRIVATE KEY-----")
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: delivery pr=" + raw_url + " sha=abc1234 tests=" + tests]
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://github.com/example/repository/pull/44",
              "statusCheckRollup": []}
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_url", return_value=pr):
            dispatcher.sync_worker_reports(state)
        stored = state["issues"]["MAI-69"].get("workerReport") or {}
        self.assertEqual(stored.get("kind"), "delivery")
        self.assertEqual(stored.get("pr"), "https://github.com/example/repository/pull/44")
        self.assertNotEqual(stored.get("pr"), raw_url)
        dump = json.dumps(stored)
        for secret in ("live-tok-AAA111", "sk-m7", "q 1", "pctok-999", "pw-m7",
                       "s3cret", "utm=evil", "token=zzz", "M7", "bot:s3cret"):
            self.assertNotIn(secret, dump)

    def test_tampered_report_url_never_replaces_canonical(self):
        reported = "https://example.test/pr/99?next=https://evil.test/x"
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: delivery pr=" + reported + " sha=abc1234 tests=ok"]
        canonical = {"number": 44, "headRefOid": "abc1234", "url": "https://github.com/example/repository/pull/44",
                     "statusCheckRollup": []}
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_url", return_value=canonical):
            dispatcher.sync_worker_reports(state)
        stored = state["issues"]["MAI-69"].get("workerReport") or {}
        self.assertEqual(stored.get("pr"), "https://github.com/example/repository/pull/44")
        dump = json.dumps(stored)
        self.assertNotIn("evil.test", dump)
        self.assertNotIn("pr/99", dump)

    def test_error_report_with_secret_matrix_stays_clean(self):
        evil = ("Authorization: Bearer err-tok-1 passwd='p w' OPENAI_API_KEY=sk-err "
                "postgres://a:b-err@h/db?token=t-err %42earer pctok-err\n"
                "-----BEGIN RSA PRIVATE KEY-----\nMERR\n-----END RSA PRIVATE KEY-----")
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: error boom " + evil]
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            dispatcher.sync_worker_reports(state)
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "error")
        dump = json.dumps(state["issues"]["MAI-69"])
        for secret in ("err-tok-1", "p w", "sk-err", "b-err", "t-err",
                       "pctok-err", "MERR"):
            self.assertNotIn(secret, dump)

    def test_blocked_report_with_secret_matrix_stays_clean(self):
        evil = ("blocked by wall Authorization: %42earer blk-tok-1\n"
                "client_secret=blk-s3cr3t https://u:p-blk@hooks/x?k=v\n"
                "-----BEGIN EC PRIVATE KEY-----\nMBLK\n-----END EC PRIVATE KEY-----")
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: " + evil]
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            dispatcher.sync_worker_reports(state)
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "blocked")
        dump = json.dumps(state["issues"]["MAI-69"])
        for secret in ("blk-tok-1", "blk-s3cr3t", "p-blk", "MBLK"):
            self.assertNotIn(secret, dump)


    def test_canonicalization_converges_zero_to_ten_layers(self):
        for layers in (0, 1, 2, 5, 10):
            evil = "prefix " + _encode_layers("Bearer nest-tok-72", layers) + " suffix"
            for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
                clean = fn(evil)
                self.assertNotIn("nest-tok-72", _decode_all(clean),
                                 "layers=%d via %s" % (layers, fn.__name__))

    def test_nonconvergent_input_fails_closed_to_redacted(self):
        evil = "x " + _encode_layers("Bearer cap-tok-72", 5)
        with patch.object(dispatcher, "_CANON_MAX_ROUNDS", 2):
            for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
                self.assertEqual(fn(evil), "[REDACTED]")

    def test_canonicalization_covers_mixed_malformed_unicode_shapes(self):
        evil = ("bearer mix-tok-1 %42earer mix-tok-2 %62earer mix-tok-3 "
                "token=%4dix-tok-4 password=%zz %2 trailing% "
                "caf%C3%A9 https://u:pw-user-9@host/x "
                "-----BEGIN RSA PRIVATE KEY-----\nM72X\n-----END RSA PRIVATE KEY-----\n"
                "secret=top-mark-9\ntail")
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            clean = fn(evil)
            for secret in ("mix-tok-1", "mix-tok-2", "mix-tok-3", "ix-tok-4",
                           "pw-user-9", "top-mark-9", "M72X"):
                self.assertNotIn(secret, _decode_all(clean))

    def test_large_payload_stays_bounded_without_expansion(self):
        big = _encode_layers("Bearer big-tok-9", 4) + "ok " * 20000
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            clean = _decode_all(fn(big))
            self.assertNotIn("big-tok-9", clean)
            self.assertLessEqual(len(clean), len(big) + 256)

    def test_delivery_e2e_converged_canonicalization_across_sinks(self):
        tests = _encode_layers("Bearer sink-tok-5", 5)
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=abc1234 tests=" + tests]
        pr = {"number": 44, "headRefOid": "abc1234", "url": "https://github.com/example/repository/pull/44",
              "statusCheckRollup": []}
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_url", return_value=pr):
            logged = _run_sync_capture_logs(state)
        blob = (json.dumps(state) + "\n"
                + "\n".join(c.args[1] for c in comment.call_args_list) + "\n"
                + logged)
        self.assertNotIn("sink-tok-5", _decode_all(blob))

    def test_error_e2e_converged_canonicalization_across_sinks(self):
        evil = _encode_layers("Bearer errsink-tok-6", 5)
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: error boom " + evil]
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            logged = _run_sync_capture_logs(state)
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "error")
        blob = (json.dumps(state) + "\n"
                + "\n".join(c.args[1] for c in comment.call_args_list) + "\n"
                + logged)
        self.assertNotIn("errsink-tok-6", _decode_all(blob))

    def test_blocked_e2e_converged_canonicalization_across_sinks(self):
        evil = _encode_layers("Bearer blksink-tok-7", 5)
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        comments = ["MeuPlantao-Report: blocked wall " + evil]
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            logged = _run_sync_capture_logs(state)
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "blocked")
        blob = (json.dumps(state) + "\n"
                + "\n".join(c.args[1] for c in comment.call_args_list) + "\n"
                + logged)
        self.assertNotIn("blksink-tok-7", _decode_all(blob))


    def test_canonical_pr_object_propagates_to_all_sinks(self):
        comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=abc1234 tests=ok"]
        pr = {"number": 44, "headRefOid": "abc1234", "url": CANON_PR_44,
              "statusCheckRollup": []}
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)) as orca_mock, \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_url", return_value=pr):
            dispatcher.sync_worker_reports(state)
        stored = state["issues"]["MAI-69"].get("workerReport") or {}
        self.assertEqual(stored.get("pr"), CANON_PR_44)
        self.assertEqual(state["issues"]["MAI-69"].get("pr"), CANON_PR_44)
        self.assertEqual(state["issues"]["MAI-69"].get("reviewMarker"), "44:abc1234")
        attach = [c for c in orca_mock.call_args_list
                  if c.args[:2] == ("linear", "attach")]
        self.assertEqual(len(attach), 1)
        args = attach[0].args
        self.assertEqual(args[args.index("--url") + 1], CANON_PR_44)
        bodies = " ".join(c.args[1] for c in comment.call_args_list)
        self.assertIn(CANON_PR_44, bodies)
        blob = json.dumps(state) + "\n" + bodies
        self.assertNotIn("example.test", blob)

    def test_tampered_verifier_output_never_reaches_sinks(self):
        dirty_urls = [
            "https://evil.test/example/repository/pull/44",
            "https://github.com/example/repository/pull/44?utm=evil&token=zzz",
            "https://bot:s3cret@github.com/example/repository/pull/44",
            "http://github.com/example/repository/pull/44",
            "https://github.com/example/repository/pull/99",
            "https://github.com/other/repo/pull/44",
            "https://github.com:8443/example/repository/pull/44",
            "https://github.com/example/repository/pull/44#frag",
        ]
        for dirty in dirty_urls:
            state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
            comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=abc1234 tests=ok"]
            pr = {"number": 44, "headRefOid": "abc1234", "url": dirty,
                  "statusCheckRollup": []}
            with patch.object(dispatcher, "orca",
                              return_value=_linear_issue("In Progress", [], comments=comments)), \
                 patch.object(dispatcher, "linear_comment") as comment, \
                 patch.object(dispatcher, "save_state"), \
                 patch.object(dispatcher, "gh_pr_for_url", return_value=pr):
                dispatcher.sync_worker_reports(state)
            local = state["issues"]["MAI-69"]
            self.assertEqual(local.get("status"), "dispatched", dirty)
            self.assertNotIn("workerReport", local, dirty)
            self.assertNotIn("reviewMarker", local, dirty)
            blob = json.dumps(local) + "\n" + " ".join(
                c.args[1] for c in comment.call_args_list)
            self.assertNotIn("evil.test", blob, dirty)
            self.assertNotIn("s3cret", blob, dirty)
            self.assertNotIn("other/repo", blob, dirty)
            self.assertNotIn("pull/99", blob, dirty)

    def test_monitor_rejects_tampered_branch_pr(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1",
                                       "workerReport": {"kind": "delivery",
                                                        "pr": CANON_PR_44,
                                                        "sha": "abc1234", "tests": "ok",
                                                        "number": 44, "head": "abc1234"}}}}
        tampered = {"number": 99, "headRefOid": "abc1234", "url": CANON_PR_44,
                    "statusCheckRollup": []}
        wt = dict(WORKTREE, branch="lMaick/MAI-69-x")
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [])), \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "gh_pr_for_branch", return_value=tampered):
            dispatcher.monitor_deliveries(state, [wt])
        self.assertEqual(state["issues"]["MAI-69"].get("status"), "dispatched")
        self.assertNotIn("reviewMarker", state["issues"]["MAI-69"])
        blob = json.dumps(state["issues"]["MAI-69"]) + "\n" + " ".join(
            c.args[1] for c in comment.call_args_list)
        self.assertNotIn("pull/99", blob)

    def test_gh_pr_for_url_returns_validated_canonical_object(self):
        clean = {"number": 44, "url": CANON_PR_44, "headRefOid": "ABC1234",
                 "title": "t", "state": "OPEN", "baseRefName": "main"}
        with patch.object(dispatcher, "run", return_value=json.dumps(clean)):
            pr = dispatcher.gh_pr_for_url("https://example.test/pr/44")
        self.assertEqual(pr["url"], CANON_PR_44)
        self.assertEqual(pr["number"], 44)
        self.assertEqual(pr["headRefOid"], "abc1234")
        dirty = dict(clean, url="https://evil.test/example/repository/pull/44")
        with patch.object(dispatcher, "run", return_value=json.dumps(dirty)):
            with self.assertRaises(RuntimeError):
                dispatcher.gh_pr_for_url("https://example.test/pr/44")


def _u_escape(text):
    return "".join("\\u%04x" % ord(ch) for ch in text)


def _decode_fully(text):
    from urllib.parse import unquote
    simple = {'"': '"', "\\": "\\", "/": "/",
              "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
    hexdigits = set("0123456789abcdefABCDEF")
    current = str(text)
    for _ in range(60):
        step = unquote(current)
        out = []
        i = 0
        while i < len(step):
            ch = step[i]
            if ch == "\\" and i + 1 < len(step):
                nxt = step[i + 1]
                if nxt == "u" and i + 6 <= len(step):
                    hexpart = step[i + 2:i + 6]
                    if all(c in hexdigits for c in hexpart):
                        unit = int(hexpart, 16)
                        if 0xD800 <= unit <= 0xDBFF and step[i + 6:i + 8] == "\\u":
                            low = step[i + 8:i + 12]
                            if len(low) == 4 and all(c in hexdigits for c in low):
                                lowsed = int(low, 16)
                                if 0xDC00 <= lowed <= 0xDFFF:
                                    out.append(chr(0x10000 + ((unit - 0xD800) << 10) + (lowed - 0xDC00)))
                                    i += 12
                                    continue
                        if not 0xD800 <= unit <= 0xDFFF:
                            out.append(chr(unit))
                            i += 6
                            continue
                elif nxt in simple:
                    out.append(simple[nxt])
                    i += 2
                    continue
            out.append(ch)
            i += 1
        step = "".join(out)
        if step == current:
            return step
        current = step
    return current


class UnicodeEscapeMatrixTests(unittest.TestCase):
    def test_unicode_escapes_normalized_before_secret_scrub(self):
        evil = "\\u0042earer uniU-tok-1"
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            clean = _decode_fully(fn(evil))
            self.assertNotIn("uniU-tok-1", clean)
            self.assertNotIn("Bearer", clean)
        hidden = "Bearer " + _u_escape("uniU-tok-2")
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            self.assertNotIn("uniU-tok-2", _decode_fully(fn(hidden)))
        pair = "prefix \\uD83D\\uDE00 suffix"
        self.assertIn("\U0001F600", _decode_fully(dispatcher.sanitize_for_log(pair)))
        mixed = "Bearer\\u0020uniU-tok-3"
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            self.assertNotIn("uniU-tok-3", _decode_fully(fn(mixed)))
        layered = "%5Cu0042earer%20uniU-tok-4"
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            clean = _decode_fully(fn(layered))
            self.assertNotIn("uniU-tok-4", clean)
            self.assertNotIn("Bearer", clean)

    def test_malformed_escapes_stay_inert_and_encodable(self):
        evil = "\\uZZZZ \\u12 trailing\\ \\uD800 lone Bearer uniU-tok-5"
        for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
            clean = fn(evil)
            clean.encode("utf-8")
            self.assertNotIn("uniU-tok-5", _decode_fully(clean))

    def test_deep_mixed_layers_fail_closed_when_rounds_exhausted(self):
        from urllib.parse import quote
        evil = quote(quote("\\u0042earer uniU-tok-6"))
        with patch.object(dispatcher, "_CANON_MAX_ROUNDS", 2):
            for fn in (dispatcher.sanitize_for_linear, dispatcher.sanitize_for_log):
                self.assertEqual(fn(evil), "[REDACTED]")

    def test_unicode_escape_matrix_across_error_blocked_delivery(self):
        kinds = {
            "delivery": "MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=abc1234 tests=",
            "error": "MeuPlantao-Report: error boom ",
            "blocked": "MeuPlantao-Report: blocked wall ",
        }
        sentinels = {"delivery": "uniM-tok-1", "error": "uniM-tok-2", "blocked": "uniM-tok-3"}
        canon = {"number": 44, "headRefOid": "abc1234",
                 "url": "https://github.com/example/repository/pull/44",
                 "statusCheckRollup": []}
        for kind, prefix in kinds.items():
            with self.subTest(kind=kind):
                hidden = _u_escape("Bearer " + sentinels[kind])
                state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
                comments = [prefix + hidden]
                with patch.object(dispatcher, "orca",
                                  return_value=_linear_issue("In Progress", [], comments=comments)), \
                     patch.object(dispatcher, "linear_comment") as comment, \
                     patch.object(dispatcher, "save_state"), \
                     patch.object(dispatcher, "gh_pr_for_url", return_value=dict(canon)):
                    logged = _run_sync_capture_logs(state)
                blob = (json.dumps(state) + "\n"
                        + "\n".join(c.args[1] for c in comment.call_args_list) + "\n"
                        + logged)
                self.assertNotIn(sentinels[kind], _decode_fully(blob))
                if kind == "delivery":
                    self.assertEqual(state["issues"]["MAI-69"].get("status"), "needs-review")
                else:
                    self.assertIn(state["issues"]["MAI-69"].get("status"), ("error", "blocked"))



class ClosedPRSchemaTests(unittest.TestCase):
    def _valid_pr(self, **over):
        base = {"number": 44, "headRefOid": "abc1234",
                "url": "https://github.com/example/repository/pull/44",
                "statusCheckRollup": []}
        base.update(over)
        return base

    def test_canonical_pr_builds_closed_allowlist_schema(self):
        import copy
        junk = self._valid_pr(
            title="t", state="OPEN", baseRefName="main",
            author={"login": "mallory"}, extra=[1, 2, 3],
            statusCheckRollup=[{"name": "ci", "conclusion": "SUCCESS",
                                "evil": 1, "nested": {"a": 1}}])
        before = copy.deepcopy(junk)
        pr = dispatcher.canonical_pr(junk)
        self.assertEqual(set(pr.keys()),
                         {"number", "headRefOid", "url", "statusCheckRollup"})
        self.assertEqual(pr, {"number": 44, "headRefOid": "abc1234",
                              "url": "https://github.com/example/repository/pull/44",
                              "statusCheckRollup": [{"name": "ci", "conclusion": "SUCCESS"}]})
        self.assertIs(type(pr["number"]), int)
        self.assertIs(type(pr["headRefOid"]), str)
        self.assertIs(type(pr["url"]), str)
        self.assertIs(type(pr["statusCheckRollup"]), list)
        self.assertEqual(junk, before)
        self.assertIsNot(pr["statusCheckRollup"], junk["statusCheckRollup"])
        legacy = self._valid_pr(statusCheckRollup=[{"context": "ctx", "state": "ok",
                                                    "extra": 1}])
        pr2 = dispatcher.canonical_pr(legacy)
        self.assertEqual(pr2["statusCheckRollup"], [{"name": "ctx", "conclusion": "ok"}])
        self.assertEqual(set(pr2["statusCheckRollup"][0].keys()), {"name", "conclusion"})

    def test_canonical_pr_rejects_ambiguous_types(self):
        pull = "https://github.com/example/repository/pull/"
        bad_numbers = [True, False, 44.5, 44.0, 0, -3, None, "4x", [44], {"n": 44}]
        for bad in bad_numbers:
            with self.subTest(number=bad):
                with self.assertRaises(RuntimeError):
                    dispatcher.canonical_pr(self._valid_pr(number=bad, url=pull + "44"))
        with self.subTest(number="zero-url"):
            with self.assertRaises(RuntimeError):
                dispatcher.canonical_pr(self._valid_pr(number=0, url=pull + "0"))
        for bad in [12345, None, "", "   ", ["abc1234"]]:
            with self.subTest(head=bad):
                with self.assertRaises(RuntimeError):
                    dispatcher.canonical_pr(self._valid_pr(headRefOid=bad))
        for bad in [123, None, ["x"]]:
            with self.subTest(url=bad):
                with self.assertRaises(RuntimeError):
                    dispatcher.canonical_pr(self._valid_pr(url=bad))
        for bad in [{"a": 1}, "x", [42], [{"name": "ci"}, "oops"]]:
            with self.subTest(rollup=bad):
                with self.assertRaises(RuntimeError):
                    dispatcher.canonical_pr(self._valid_pr(statusCheckRollup=bad))
        pr = dispatcher.canonical_pr(self._valid_pr(number="44"))
        self.assertEqual(pr["number"], 44)
        self.assertIs(type(pr["number"]), int)

    def test_zero_number_never_promotes_e2e(self):
        comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/0 sha=abc1234 tests=ok"]
        zero = {"number": 0, "headRefOid": "abc1234",
                "url": "https://github.com/example/repository/pull/0",
                "statusCheckRollup": []}
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        with patch.object(dispatcher, "orca",
                          return_value=_linear_issue("In Progress", [], comments=comments)), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"), \
             patch.object(dispatcher, "gh_pr_for_url", return_value=zero):
            dispatcher.sync_worker_reports(state)
        local = state["issues"]["MAI-69"]
        self.assertEqual(local.get("status"), "dispatched")
        self.assertNotIn("workerReport", local)
        self.assertNotIn("reviewMarker", local)

class MarkForReviewBoundaryTests(unittest.TestCase):
    def _valid_pr(self, **over):
        base = {"number": 44, "headRefOid": "abc1234",
                "url": "https://github.com/example/repository/pull/44",
                "statusCheckRollup": []}
        base.update(over)
        return base
    def _sink_text(self, state, orca_mock, comment_mock):
        snapshot = json.dumps(state.get("issues", {}).get("MAI-69", {}),
                              sort_keys=True, default=str)
        attach_urls = [args[4] for args in (c.args for c in orca_mock.call_args_list)
                       if len(args) >= 5 and args[1] == "attach"]
        bodies = [c.args[1] for c in comment_mock.call_args_list]
        marker = state.get("issues", {}).get("MAI-69", {}).get("reviewMarker")
        return snapshot, attach_urls, bodies, marker
    def test_direct_spoofed_urls_fail_closed_without_raw_sinks(self):
        spoofed = [
            "https://evil.test/example/repository/pull/44",
            "https://github.com/evil/repository/pull/44",
            "https://github.com/example/wrong/pull/44",
            "https://mallory:secret@github.com/example/repository/pull/44",
            "https://github.com/example/repository/pull/44?x=1",
            "https://github.com/example/repository/pull/44#frag",
            "https://github.com:443/example/repository/pull/44",
            "http://github.com/example/repository/pull/44",
            "https://github.com/example/repository/pull/45",
        ]
        for raw_url in spoofed:
            with self.subTest(url=raw_url):
                state = {"issues": {}}
                pr = self._valid_pr(url=raw_url)
                with patch.object(dispatcher, "orca") as orca_mock, patch.object(dispatcher, "linear_comment") as comment_mock, patch.object(dispatcher, "save_state"):
                    with self.assertRaises(RuntimeError):
                        dispatcher.mark_for_review("MAI-69", pr, state)
                local = state.get("issues", {}).get("MAI-69", {})
                self.assertNotEqual(local.get("status"), "needs-review")
                self.assertNotIn("reviewMarker", local)
                snapshot, attach_urls, bodies, _ = self._sink_text(state, orca_mock, comment_mock)
                self.assertNotIn(raw_url, snapshot)
                self.assertNotIn(raw_url, " ".join(bodies))
                for attached in attach_urls:
                    self.assertNotEqual(attached, raw_url)
                self.assertNotIn("evil", snapshot)
                self.assertNotIn("mallory", snapshot)
    def test_direct_invalid_sha_forms_fail_closed(self):
        bad_shas = ["", "   ", 12345, ["abc1234"], "x" * 129]
        for bad in bad_shas:
            with self.subTest(sha=bad):
                state = {"issues": {}}
                pr = self._valid_pr(headRefOid=bad)
                with patch.object(dispatcher, "orca") as orca_mock, patch.object(dispatcher, "linear_comment") as comment_mock, patch.object(dispatcher, "save_state"):
                    with self.assertRaises(RuntimeError):
                        dispatcher.mark_for_review("MAI-69", pr, state)
                local = state.get("issues", {}).get("MAI-69", {})
                self.assertNotEqual(local.get("status"), "needs-review")
                self.assertNotIn("reviewMarker", local)
    def test_uppercase_sha_normalized_in_all_sinks(self):
        state = {"issues": {}}
        pr = self._valid_pr(headRefOid="ABC1234")
        with patch.object(dispatcher, "orca") as orca_mock, patch.object(dispatcher, "linear_comment") as comment_mock, patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-69", pr, state)
        local = state["issues"]["MAI-69"]
        self.assertEqual(local["headSha"], "abc1234")
        self.assertEqual(local["reviewMarker"], "44:abc1234")
        snapshot, attach_urls, bodies, marker = self._sink_text(state, orca_mock, comment_mock)
        self.assertEqual(marker, "44:abc1234")
        self.assertNotIn("ABC1234", snapshot)
        self.assertNotIn("ABC1234", " ".join(bodies))
        self.assertIn("https://github.com/example/repository/pull/44", snapshot)
        self.assertIn("https://github.com/example/repository/pull/44", attach_urls)
    def test_extra_fields_stripped_from_all_sinks(self):
        state = {"issues": {}}
        pr = self._valid_pr(title="t", state="OPEN", baseRefName="main",
                            author={"login": "mallory"}, evil="payload",
                            token="ghp_0123456789abcdef0123456789abcdef0123",
                            statusCheckRollup=[{"name": "ci", "conclusion": "ok", "evil": 1}])
        with patch.object(dispatcher, "orca") as orca_mock, patch.object(dispatcher, "linear_comment") as comment_mock, patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-69", pr, state)
        local = state["issues"]["MAI-69"]
        self.assertEqual(local["pr"], "https://github.com/example/repository/pull/44")
        self.assertEqual(local["reviewMarker"], "44:abc1234")
        snapshot, attach_urls, bodies, _ = self._sink_text(state, orca_mock, comment_mock)
        for probe in ("evil", "mallory", "ghp_0123456789abcdef0123456789abcdef0123", "OPEN", "baseRefName"):
            self.assertNotIn(probe, snapshot)
            self.assertNotIn(probe, " ".join(bodies))
            for attached in attach_urls:
                self.assertNotIn(probe, attached)
    def test_sync_path_with_spoofed_verifier_output_fails_closed(self):
        comments = ["MeuPlantao-Report: delivery pr=https://example.test/pr/44 sha=abc1234 tests=ok"]
        spoofed = {"number": 44, "headRefOid": "abc1234",
                   "url": "https://evil.test/example/repository/pull/44",
                   "statusCheckRollup": []}
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        with patch.object(dispatcher, "orca", return_value=_linear_issue("In Progress", [], comments=comments)), patch.object(dispatcher, "linear_comment") as comment_mock, patch.object(dispatcher, "save_state"), patch.object(dispatcher, "gh_pr_for_url", return_value=dict(spoofed)):
            dispatcher.sync_worker_reports(state)
        local = state["issues"]["MAI-69"]
        self.assertEqual(local.get("status"), "dispatched")
        self.assertNotIn("reviewMarker", local)
        blob = json.dumps(local, sort_keys=True, default=str)
        self.assertNotIn("evil.test", blob)
        self.assertNotIn("evil.test", " ".join(c.args[1] for c in comment_mock.call_args_list))


class CheckFieldSanitizationTests(unittest.TestCase):
    SECRET = "ghp_" + "B" * 32
    BEARER = "Bearer TEST-SENTINEL-ABC123"

    def _valid_pr(self, **over):
        base = {"number": 44, "headRefOid": "abc1234",
                "url": "https://github.com/example/repository/pull/44",
                "statusCheckRollup": []}
        base.update(over)
        return base

    def _sink_text(self, state, orca_mock, comment_mock):
        snapshot = json.dumps(state.get("issues", {}).get("MAI-79", {}),
                              sort_keys=True, default=str)
        attach_urls = [args[4] for args in (c.args for c in orca_mock.call_args_list)
                       if len(args) >= 5 and args[1] == "attach"]
        bodies = [c.args[1] for c in comment_mock.call_args_list]
        return snapshot, attach_urls, bodies

    def test_canonical_pr_sanitizes_check_secrets(self):
        modern = self._valid_pr(statusCheckRollup=[
            {"name": "ci " + self.SECRET, "conclusion": "ok " + self.BEARER}])
        pr = dispatcher.canonical_pr(modern)
        blob = json.dumps(pr)
        self.assertNotIn(self.SECRET, blob)
        self.assertNotIn(self.BEARER, blob)
        legacy = self._valid_pr(statusCheckRollup=[
            {"context": "ctx " + self.SECRET, "state": self.BEARER, "extra": 1}])
        pr2 = dispatcher.canonical_pr(legacy)
        blob2 = json.dumps(pr2)
        self.assertNotIn(self.SECRET, blob2)
        self.assertNotIn(self.BEARER, blob2)
        self.assertEqual(set(pr2["statusCheckRollup"][0].keys()), {"name", "conclusion"})
        clean = dispatcher.canonical_pr(self._valid_pr(
            statusCheckRollup=[{"name": "ci", "conclusion": "SUCCESS"}]))
        self.assertEqual(clean["statusCheckRollup"], [{"name": "ci", "conclusion": "SUCCESS"}])

    def test_canonical_pr_decodes_and_scrubs_encoded_check_secrets(self):
        pct = _encode_layers(self.BEARER, 1)
        self.assertNotEqual(pct, self.BEARER)
        uni = "\\u0042earer TEST-SENTINEL-ABC123"
        pr = dispatcher.canonical_pr(self._valid_pr(statusCheckRollup=[
            {"name": "ci " + pct, "conclusion": "ok " + uni}]))
        blob = json.dumps(pr)
        for probe in (self.BEARER, pct, uni):
            self.assertNotIn(probe, blob)

    def test_mark_for_review_publishes_no_raw_or_reversible_check_content(self):
        pct = _encode_layers(self.BEARER, 1)
        uni = "\\u0067hp_" + "B" * 32
        raw = self._valid_pr(statusCheckRollup=[
            {"name": "ci " + self.SECRET, "conclusion": "ok " + pct},
            {"context": "legacy " + uni, "status": "ok"}])
        state = {"issues": {}}
        with patch.object(dispatcher, "orca") as orca_mock, patch.object(dispatcher, "linear_comment") as comment_mock, patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-79", raw, state)
        self.assertEqual(state["issues"]["MAI-79"]["status"], "needs-review")
        snapshot, attach_urls, bodies = self._sink_text(state, orca_mock, comment_mock)
        blob = snapshot + " ".join(bodies) + " ".join(attach_urls)
        for probe in (self.SECRET, self.BEARER, pct, uni):
            self.assertNotIn(probe, blob)

    def test_check_field_size_limits(self):
        pr = dispatcher.canonical_pr(self._valid_pr(statusCheckRollup=[
            {"name": "n" * 500, "conclusion": "c" * 500}]))
        self.assertEqual(len(pr["statusCheckRollup"][0]["name"]), 300)
        self.assertEqual(len(pr["statusCheckRollup"][0]["conclusion"]), 300)
        huge = dispatcher.canonical_pr(self._valid_pr(statusCheckRollup=[
            {"name": "\\u0041" * 70000, "conclusion": "ok"}]))
        self.assertEqual(huge["statusCheckRollup"][0]["name"], "[REDACTED]")

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
