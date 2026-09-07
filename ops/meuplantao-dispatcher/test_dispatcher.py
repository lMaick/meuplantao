import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher

ISSUE = {"id": "uuid-60", "identifier": "MAI-60", "title": "Auto sync"}
WORKTREE = {"id": "wt-60", "path": "C:/work/MAI-60", "displayName": "MAI-60-auto", "linkedLinearIssue": "MAI-60"}

class DispatcherBehaviourTests(unittest.TestCase):
    def test_config_absent_or_incomplete_fails_closed(self):
        with self.assertRaises(RuntimeError): dispatcher.load_config(Path("missing-config.toml"))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config.toml"; p.write_text('team = "only-team"\n', encoding="utf-8")
            with self.assertRaises(RuntimeError): dispatcher.load_config(p)

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
        responses = [{"issue": {"state": {"name": "In Progress"}, "labels": []}}, {"terminals": [{"handle": "term-60", "agentIdentity": "codex"}]}, {"terminal": {"tail": ["model:       gpt-5.6-luna low"]}}]
        with patch.object(dispatcher, "orca", side_effect=responses), patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"), patch.object(dispatcher, "create_workspace") as create:
            dispatcher.reconcile_dispatches(state, [WORKTREE])
        self.assertEqual(state["issues"]["MAI-60"]["status"], "dispatched"); create.assert_not_called()

    def test_review_new_pr_writes_expected_commands_but_never_done(self):
        state = {"issues": {}}; pr = {"number": 32, "headRefOid": "abc123", "url": "https://example.test/pr/32", "statusCheckRollup": []}
        with patch.object(dispatcher, "orca") as fake, patch.object(dispatcher, "linear_comment"), patch.object(dispatcher, "save_state"):
            dispatcher.mark_for_review("MAI-60", pr, state)
        args = [a for c in fake.call_args_list for a in c.args]
        for value in ("attach", "Needs Review", "Orca Ready", "In Progress"): self.assertIn(value, args)
        self.assertNotIn("Done", args)

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
        for value in ("MaickAgent", "MeuPlantao — Operação", "Todo", "Orca Ready", dispatcher.LINEAR_WORKSPACE_ID): self.assertIn(value, args)
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