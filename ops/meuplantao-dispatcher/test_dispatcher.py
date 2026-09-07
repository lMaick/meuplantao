import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher


class DispatcherTests(unittest.TestCase):
    def test_config_missing_and_incomplete_fail_closed(self):
        with self.assertRaises(RuntimeError): dispatcher.load_config(Path("does-not-exist.toml"))
        with self.assertRaises(RuntimeError):
            with tempfile.TemporaryDirectory() as directory:
                config_path = Path(directory) / "config.toml"
                config_path.write_text('team = "x"\n', encoding="utf-8")
                dispatcher.load_config(config_path)

    def test_slug_is_ascii_and_issue_scoped(self):
        self.assertTrue(dispatcher.slugify("MAI-60", "Corrigir auto-sync Orca") .startswith("MAI-60-"))

    def test_duplicate_worktrees_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "multiple worktrees"):
            dispatcher.linked_worktree("MAI-60", [{"linkedLinearIssue": "MAI-60"}, {"displayName": "MAI-60-copy"}])

    def test_prefix_deduplication_and_exact_eligibility_query(self):
        self.assertEqual(dispatcher.linked_worktree("MAI-60", [{"displayName": "MAI-60-fix"}])["displayName"], "MAI-60-fix")
        with patch.object(dispatcher, "orca", return_value={"issues": [], "meta": {}}) as fake:
            self.assertEqual(dispatcher.list_eligible_issues(), [])
            args = fake.call_args.args
            self.assertEqual(args[:2], ("linear", "list-issues"))
            self.assertIn("--state", args); self.assertIn("Todo", args)
            self.assertIn("--label", args); self.assertIn(dispatcher.READY_LABEL, args)

    def test_pr_marker_is_idempotent_and_missing_identity_fails_closed(self):
        state = {"issues": {"MAI-60": {"reviewMarker": "32:abc"}}}
        with self.assertRaises(ValueError): dispatcher.mark_for_review("MAI-60", {}, {"issues": {}})
        with patch.object(dispatcher, "orca") as fake:
            dispatcher.mark_for_review("MAI-60", {"number": 32, "headRefOid": "abc", "url": "https://example.test/pr/32"}, state)
            fake.assert_not_called()

    def test_required_agent_constants(self):
        self.assertEqual(dispatcher.MODEL, "gpt-5.6-luna")
        self.assertEqual(dispatcher.REASONING, "low")
        self.assertEqual(dispatcher.MAX_DISPATCH_PER_RUN, 1)

    def test_review_marker_requires_pr_identity(self):
        with self.assertRaises(ValueError): dispatcher.mark_for_review("MAI-60", {}, {"issues": {}})


if __name__ == "__main__": unittest.main()
