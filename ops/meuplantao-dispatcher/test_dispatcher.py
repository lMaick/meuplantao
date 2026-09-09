import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

_fixture_dir = tempfile.TemporaryDirectory()
_fixture = Path(_fixture_dir.name) / "config.toml"
_fixture.write_text('''orca_dir = "C:/orca"\ngh_executable = ""\ngithub_repo = "example/repository"\nrepo_name = "meuplantao"\nrepo_path = "C:/repo"\nworktree_root = "C:/worktrees"\nlinear_workspace_id = "workspace-id"\nteam = "Team"\nproject = "MeuPlantao \\u2014 Opera\\u00e7\\u00e3o"\n''', encoding="utf-8")
import os
os.environ["MEUPLANTAO_DISPATCHER_CONFIG"] = str(_fixture)

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher

ISSUE = {"id": "uuid-60", "identifier": "MAI-60", "title": "Auto sync"}
WORKTREE = {"id": "wt-60", "path": "C:/work/MAI-60", "displayName": "MAI-60-auto", "linkedLinearIssue": "MAI-60"}

class DispatcherBehaviourTests(unittest.TestCase):
    def test_dry_run_is_read_only_and_skips_mutating_paths(self):
        state = {"issues": {}}
        lock = type("Lock", (), {"seek": lambda self, *_: None, "fileno": lambda self: 0, "close": lambda self: None})()
        with patch.object(dispatcher, "acquire_lock", return_value=lock), patch.object(dispatcher.msvcrt, "locking"), patch.object(dispatcher, "load_state", return_value=state), patch.object(dispatcher, "get_control_mode", return_value="AUTO"), patch.object(dispatcher, "orca", return_value={"runtime": {"reachable": True}}), patch.object(dispatcher, "list_worktrees", return_value=[]), patch.object(dispatcher, "list_eligible_issues", return_value=[ISSUE]), patch.object(dispatcher, "dispatch_issue") as dispatch, patch.object(dispatcher, "reconcile_dispatches") as reconcile, patch.object(dispatcher, "monitor_deliveries") as monitor, patch.object(dispatcher, "save_state") as save, patch.object(sys, "argv", ["dispatcher.py", "--dry-run"]):
            self.assertEqual(dispatcher.main(), 0)
        dispatch.assert_called_once_with(ISSUE, state, [], True)
        reconcile.assert_not_called(); monitor.assert_not_called(); save.assert_not_called()

    def test_config_absent_or_incomplete_fails_closed(self):
        with self.assertRaises(RuntimeError): dispatcher.load_config(Path("missing-config.toml"))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config.toml"; p.write_text('team = "only-team"\n', encoding="utf-8")
            with self.assertRaises(RuntimeError): dispatcher.load_config(p)

    def test_review_requires_main_base(self):
        with patch.object(dispatcher, "run", return_value='[{"number":32,"baseRefName":"develop"}]'):
            with self.assertRaisesRegex(RuntimeError, "not main"): dispatcher.gh_pr_for_branch("feature")

    def test_monitor_requires_local_dispatch_and_matching_linear_scope(self):
        wt = {"linkedLinearIssue": "MAI-60", "branch": "feature"}
        state = {"issues": {"MAI-60": {"status": "dispatched"}}}
        issue = {"team": {"name": "Other"}, "project": {"name": dispatcher.PROJECT}}
        with patch.object(dispatcher, "orca", return_value={"issue": issue}) as fake, patch.object(dispatcher, "gh_pr_for_branch") as gh:
            dispatcher.monitor_deliveries(state, [wt])
        gh.assert_not_called(); self.assertEqual(fake.call_args.args[:2], ("linear", "issue"))

    def test_placeholders_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config.toml"
            p.write_text('orca_dir="x"\ngh_executable=""\ngithub_repo="<OWNER>/<REPOSITORY>"\nrepo_name="r"\nrepo_path="p"\nworktree_root="w"\nlinear_workspace_id="<LINEAR_WORKSPACE_ID>"\nteam="t"\nproject="p"\n', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "placeholders"): dispatcher.load_config(p)

    def test_new_dispatch_creates_then_syncs_and_records_success(self):
        state = {"issues": {}}; events = []
        with patch.object(dispatcher, "preflight_model"), patch.object(dispatcher, "create_workspace", side_effect=lambda issue: (events.append("create") or (WORKTREE, "term-60"))), patch.object(dispatcher, "sync_started", side_effect=lambda issue: events.append("sync")), patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.dispatch_issue(ISSUE, state, [], False))
        self.assertEqual(events, ["create", "sync"]); self.assertEqual(state["issues"]["MAI-60"]["status"], "dispatched")

    def test_failure_before_sync_preserves_retry_and_never_done(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model", side_effect=RuntimeError("Linear unavailable")), patch.object(dispatcher, "create_workspace") as create, patch.object(dispatcher, "sync_started") as sync, patch.object(dispatcher, "linear_comment") as comment, patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [], False))
        create.assert_not_called(); sync.assert_not_called(); comment.assert_called_once()
        self.assertEqual(state["issues"]["MAI-60"]["status"], "error"); self.assertNotIn("Done", comment.call_args.args[1])

    def test_comment_failure_after_sync_keeps_success(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model"), patch.object(dispatcher, "create_workspace", return_value=(WORKTREE, "term-60")), patch.object(dispatcher, "sync_started"), patch.object(dispatcher, "linear_comment", side_effect=RuntimeError("API retry")), patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.dispatch_issue(ISSUE, state, [], False))
        self.assertEqual(state["issues"]["MAI-60"]["status"], "dispatched"); self.assertIn("reportingError", state["issues"]["MAI-60"])

    def test_existing_workspace_recovers_without_create(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model"), patch.object(dispatcher, "recover_existing", return_value="term-60") as recover, patch.object(dispatcher, "create_workspace") as create, patch.object(dispatcher, "sync_started"), patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.dispatch_issue(ISSUE, state, [WORKTREE], False))
        recover.assert_called_once_with(ISSUE, WORKTREE); create.assert_not_called()

    def test_reconcile_confirmed_dispatch_does_not_create_resources(self):
        state = {"issues": {}}
        responses = [{"issue": {"team": {"name": "Team"}, "project": {"name": "MeuPlantao — Operação"}, "state": {"name": "In Progress"}, "labels": []}}, {"terminals": [{"handle": "term-60", "agentIdentity": "codex"}]}, {"terminal": {"tail": ["model:       gpt-5.6-luna low"]}}]
        with patch.object(dispatcher, "orca", side_effect=responses), patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"), patch.object(dispatcher, "create_workspace") as create:
            dispatcher.reconcile_dispatches(state, [WORKTREE])
        self.assertEqual(state["issues"]["MAI-60"]["status"], "dispatched"); create.assert_not_called()

    def test_reconcile_removes_residual_ready_and_reads_back_without_creation(self):
        state = {"issues": {}}
        wt = dict(WORKTREE)
        responses = [
            {"issue": {"team": {"name": "Team"}, "project": {"name": "MeuPlantao — Operação"}, "state": {"name": "In Progress"}, "labels": [{"name": "Orca Ready"}]}},
            {}, {},
            {"issue": {"team": {"name": "Team"}, "project": {"name": "MeuPlantao — Operação"}, "state": {"name": "In Progress"}, "labels": []}},
            {"terminals": [{"handle": "term-60", "agentIdentity": "codex"}]},
            {"terminal": {"tail": ["model:       gpt-5.6-luna low"]}},
        ]
        with patch.object(dispatcher, "orca", side_effect=responses) as fake, patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"), patch.object(dispatcher, "create_workspace") as create:
            dispatcher.reconcile_dispatches(state, [wt])
        self.assertEqual(state["issues"]["MAI-60"]["status"], "dispatched")
        calls = [c.args for c in fake.call_args_list]
        self.assertIn(("linear", "label", "remove", "MAI-60", "--label", dispatcher.READY_LABEL, "--workspace", dispatcher.LINEAR_WORKSPACE_ID), calls)
        self.assertEqual(sum(1 for c in calls if c[:2] == ("worktree", "create")), 0)
        self.assertEqual(sum(1 for c in calls if c[:2] == ("terminal", "create")), 0)

    def test_review_new_pr_writes_expected_commands_but_never_done(self):
        state = {"issues": {}}; pr = {"number": 32, "headRefOid": "abc123", "url": "https://example.test/pr/32", "statusCheckRollup": []}
        with patch.object(dispatcher, "orca") as fake, patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-60", pr, state)
        args = [a for c in fake.call_args_list for a in c.args]
        for value in ("attach", "Needs Review", "Orca Ready", "In Progress"): self.assertIn(value, args)
        self.assertNotIn("Done", args)

    def test_attachment_attempt_is_at_most_once_after_crash(self):
        state = {"issues": {}}; pr = {"number": 32, "headRefOid": "crash-a", "url": "https://example.test/pr/32"}
        with patch.object(dispatcher, "orca", side_effect=RuntimeError("attachment crash")) as fake, patch.object(dispatcher, "save_state"):
            with self.assertRaises(RuntimeError): dispatcher.mark_for_review("MAI-60", pr, state)
        with patch.object(dispatcher, "orca") as retry, patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-60", pr, state)
        self.assertEqual(sum(1 for c in fake.call_args_list if c.args[:3] == ("linear", "attach", "MAI-60")), 1)
        self.assertFalse(any(c.args[:3] == ("linear", "attach", "MAI-60") for c in retry.call_args_list))
        self.assertTrue(state["issues"]["MAI-60"]["reviewStages"]["attachmentAttempted"])

    def test_comment_attempt_is_at_most_once_after_crash(self):
        state = {"issues": {}}; pr = {"number": 32, "headRefOid": "crash-c", "url": "https://example.test/pr/32"}
        with patch.object(dispatcher, "orca"), patch.object(dispatcher, "linear_comment", side_effect=RuntimeError("comment crash")) as comment, patch.object(dispatcher, "save_state"):
            with self.assertRaises(RuntimeError): dispatcher.mark_for_review("MAI-60", pr, state)
        with patch.object(dispatcher, "orca") as retry_orca, patch.object(dispatcher, "linear_comment") as retry_comment, patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-60", pr, state)
        self.assertEqual(comment.call_count, 1); retry_comment.assert_not_called(); retry_orca.assert_not_called()
        self.assertTrue(state["issues"]["MAI-60"]["reviewStages"]["commentAttempted"])
        self.assertEqual(state["issues"]["MAI-60"]["status"], "needs-review")
        self.assertEqual(state["issues"]["MAI-60"]["reviewMarker"], "32:crash-c")

    def test_new_marker_resets_stages_and_applies_new_review_effects(self):
        state = {"issues": {"MAI-60": {"reviewMarker": "32:old", "reviewStages": {"marker": "32:old", "attachmentDone": True, "commentDone": True}}}}
        pr = {"number": 32, "headRefOid": "new-sha", "url": "https://example.test/pr/32", "statusCheckRollup": []}
        with patch.object(dispatcher, "orca") as fake, patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-60", pr, state)
        args = [a for c in fake.call_args_list for a in c.args]
        self.assertEqual(args.count("attach"), 1); self.assertEqual(state["issues"]["MAI-60"]["reviewMarker"], "32:new-sha")
        self.assertEqual(state["issues"]["MAI-60"]["headSha"], "new-sha")

    def test_same_pr_marker_performs_zero_writes(self):
        state = {"issues": {"MAI-60": {"reviewMarker": "32:abc123"}}}
        with patch.object(dispatcher, "orca") as fake, patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-60", {"number": 32, "headRefOid": "abc123", "url": "https://example.test/pr/32"}, state)
        fake.assert_not_called()

    def test_pr_without_identity_fails_closed(self):
        with self.assertRaises(ValueError): dispatcher.mark_for_review("MAI-60", {}, {"issues": {}})

    def test_lock_second_acquisition_returns_none(self):
        with tempfile.TemporaryDirectory() as d, patch.object(dispatcher, "ROOT", Path(d)), patch.object(dispatcher, "LOCK_PATH", Path(d) / "dispatcher.lock"):
            first = dispatcher.acquire_lock()
            try:
                self.assertIsNotNone(first); self.assertIsNone(dispatcher.acquire_lock())
            finally:
                first.seek(0); dispatcher.msvcrt.locking(first.fileno(), dispatcher.msvcrt.LK_UNLCK, 1); first.close()

    def test_eligibility_query_is_exact_and_truncation_fails(self):
        with patch.object(dispatcher, "orca", return_value={"issues": [], "meta": {}}) as fake: dispatcher.list_eligible_issues()
        args = fake.call_args.args
        for value in ("Team", "MeuPlantao — Operação", "Todo", "Orca Ready", "workspace-id"): self.assertIn(value, args)
        with patch.object(dispatcher, "orca", return_value={"issues": [], "truncated": True, "meta": {}}):
            with self.assertRaises(RuntimeError): dispatcher.list_eligible_issues()

    def test_artifacts_contain_no_common_mojibake(self):
        for p in Path(__file__).parent.glob("*"):
            if p.name == Path(__file__).name: continue
            if p.suffix in {".py", ".toml", ".cmd", ".xml", ".md"}:
                content = p.read_text(encoding="utf-8")
                self.assertFalse(any(token in content for token in ("Ã", "Â", "â€", "�")), p.name)

    def test_constants_keep_required_agent(self):
        self.assertEqual(dispatcher.MODEL, "gpt-5.6-luna"); self.assertEqual(dispatcher.REASONING, "low")

if __name__ == "__main__":
    unittest.main()