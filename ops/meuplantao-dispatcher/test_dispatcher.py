import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher


class DispatcherTests(unittest.TestCase):
    def test_slug_is_ascii_and_issue_scoped(self):
        self.assertTrue(dispatcher.slugify("MAI-60", "Corrigir auto-sync Orca") .startswith("MAI-60-"))

    def test_duplicate_worktrees_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "multiple worktrees"):
            dispatcher.linked_worktree("MAI-60", [{"linkedLinearIssue": "MAI-60"}, {"displayName": "MAI-60-copy"}])

    def test_required_agent_constants(self):
        self.assertEqual(dispatcher.MODEL, "gpt-5.6-luna")
        self.assertEqual(dispatcher.REASONING, "low")
        self.assertEqual(dispatcher.MAX_DISPATCH_PER_RUN, 1)

    def test_review_marker_requires_pr_identity(self):
        with self.assertRaises(ValueError): dispatcher.mark_for_review("MAI-60", {}, {"issues": {}})


if __name__ == "__main__": unittest.main()
