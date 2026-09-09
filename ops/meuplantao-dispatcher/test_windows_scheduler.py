import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import windows_scheduler

class SchedulerTests(unittest.TestCase):
    def test_enabled_task_reports_ready(self):
        out = "TaskName: MeuPlantaoDispatcher\nStatus: Ready\nEnabled: Yes\nLast Run Time: 09/09/2026 10:00\nNext Run Time: 09/09/2026 10:05\n"
        info = windows_scheduler.query_scheduler(runner=lambda *a, **k: out)
        self.assertTrue(info["exists"])
        self.assertTrue(info["enabled"])
        self.assertEqual(info["status"], "Ready")

    def test_missing_task_reports_not_exists(self):
        def boom(*a, **k):
            raise RuntimeError("ERROR: The system cannot find the file specified.")
        info = windows_scheduler.query_scheduler(runner=boom)
        self.assertFalse(info["exists"])
        self.assertIn("error", info)

    def test_disabled_task_reports_erro(self):
        out = "TaskName: MeuPlantaoDispatcher\nStatus: Disabled\nEnabled: No\n"
        info = windows_scheduler.query_scheduler(runner=lambda *a, **k: out)
        self.assertTrue(info["exists"])
        self.assertFalse(info["enabled"])

    def test_runner_error_reports_error(self):
        def boom(*a, **k):
            raise RuntimeError("scheduler service unavailable")
        info = windows_scheduler.query_scheduler(runner=boom)
        self.assertFalse(info.get("enabled", False))
        self.assertIn("error", info)

if __name__ == "__main__":
    unittest.main()
