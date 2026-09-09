import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher

ISSUE = {"id": "uuid-66", "identifier": "MAI-66", "title": "Control"}

def _lock():
    return type("Lock", (), {"seek": lambda self, *_: None, "fileno": lambda self: 0, "close": lambda self: None})()

class DispatcherPauseTests(unittest.TestCase):
    def test_paused_skips_discovery_but_keeps_reconcile_and_monitor(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "acquire_lock", return_value=_lock()), patch.object(dispatcher.msvcrt, "locking"), patch.object(dispatcher, "load_state", return_value=state), patch.object(dispatcher, "orca", return_value={"runtime": {"reachable": True}}), patch.object(dispatcher, "list_worktrees", return_value=[]), patch.object(dispatcher, "get_control_mode", return_value="PAUSED"), patch.object(dispatcher, "reconcile_dispatches") as rec, patch.object(dispatcher, "monitor_deliveries") as mon, patch.object(dispatcher, "list_eligible_issues") as elig, patch.object(dispatcher, "dispatch_issue") as disp, patch.object(dispatcher, "save_state"), patch.object(sys, "argv", ["dispatcher.py"]):
            self.assertEqual(dispatcher.main(), 0)
        rec.assert_called_once()
        self.assertGreaterEqual(mon.call_count, 1)
        elig.assert_not_called()
        disp.assert_not_called()

    def test_mode_reread_before_each_dispatch(self):
        state = {"issues": {}}
        modes = ["AUTO", "AUTO", "PAUSED"]
        def fake_mode():
            return modes.pop(0) if modes else "PAUSED"
        with patch.object(dispatcher, "acquire_lock", return_value=_lock()), patch.object(dispatcher.msvcrt, "locking"), patch.object(dispatcher, "load_state", return_value=state), patch.object(dispatcher, "orca", return_value={"runtime": {"reachable": True}}), patch.object(dispatcher, "list_worktrees", return_value=[]), patch.object(dispatcher, "get_control_mode", side_effect=fake_mode), patch.object(dispatcher, "reconcile_dispatches"), patch.object(dispatcher, "monitor_deliveries"), patch.object(dispatcher, "list_eligible_issues", return_value=[ISSUE, ISSUE]), patch.object(dispatcher, "dispatch_issue", return_value=True) as disp, patch.object(dispatcher, "save_state"), patch.object(sys, "argv", ["dispatcher.py"]):
            dispatcher.main()
        self.assertEqual(disp.call_count, 1)

    def test_manual_once_ignores_paused_for_single_dispatch(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "acquire_lock", return_value=_lock()), patch.object(dispatcher.msvcrt, "locking"), patch.object(dispatcher, "load_state", return_value=state), patch.object(dispatcher, "orca", return_value={"runtime": {"reachable": True}}), patch.object(dispatcher, "list_worktrees", return_value=[]), patch.object(dispatcher, "get_control_mode", return_value="PAUSED"), patch.object(dispatcher, "reconcile_dispatches"), patch.object(dispatcher, "monitor_deliveries"), patch.object(dispatcher, "list_eligible_issues", return_value=[ISSUE, ISSUE]), patch.object(dispatcher, "dispatch_issue", return_value=True) as disp, patch.object(dispatcher, "save_state"), patch.object(sys, "argv", ["dispatcher.py", "--manual-once"]):
            self.assertEqual(dispatcher.main(), 0)
        self.assertEqual(disp.call_count, 1)

    def test_manual_once_with_active_lock_skips_safely(self):
        with patch.object(dispatcher, "acquire_lock", return_value=None), patch.object(dispatcher, "list_eligible_issues") as elig, patch.object(sys, "argv", ["dispatcher.py", "--manual-once"]):
            self.assertEqual(dispatcher.main(), 0)
        elig.assert_not_called()

    def test_runtime_telemetry_is_sanitized(self):
        state = {"issues": {}}
        saved = {}
        with patch.object(dispatcher, "acquire_lock", return_value=_lock()), patch.object(dispatcher.msvcrt, "locking"), patch.object(dispatcher, "load_state", return_value=state), patch.object(dispatcher, "orca", return_value={"runtime": {"reachable": True}}), patch.object(dispatcher, "list_worktrees", return_value=[]), patch.object(dispatcher, "get_control_mode", return_value="AUTO"), patch.object(dispatcher, "reconcile_dispatches"), patch.object(dispatcher, "monitor_deliveries"), patch.object(dispatcher, "list_eligible_issues", return_value=[]), patch.object(dispatcher, "save_state", side_effect=lambda s: saved.update(s)), patch.object(sys, "argv", ["dispatcher.py"]):
            dispatcher.main()
        rt = saved.get("runtime", {})
        self.assertIn("lastCheck", rt)
        self.assertIn("lastResult", rt)
        blob = str(rt)
        for secret in ("token", "ghp_", "sk-", "BEGIN"):
            self.assertNotIn(secret, blob)

if __name__ == "__main__":
    unittest.main()
