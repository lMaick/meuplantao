import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import windows_scheduler

class SchedulerTests(unittest.TestCase):
    def test_default_task_name_is_real_operational_task(self):
        self.assertEqual(windows_scheduler.TASK_NAME, "Hermes-MeuPlantao-Dispatcher")

    def test_task_name_override_is_honored_without_altering_task(self):
        seen = {}
        def runner(*args, **kwargs):
            seen["args"] = list(args)
            return "TaskName: X\nStatus: Ready\nEnabled: Yes\n"
        windows_scheduler.query_scheduler(runner=runner, task_name="Custom-Task")
        self.assertIn("Custom-Task", seen["args"])

    def test_default_resolves_from_dispatcher_config(self):
        import dispatcher
        self.assertEqual(dispatcher.SCHEDULER_TASK_NAME, "Hermes-MeuPlantao-Dispatcher")
        seen = {}
        def runner(*args, **kwargs):
            seen["args"] = list(args)
            return "TaskName: X\nStatus: Ready\nEnabled: Yes\n"
        windows_scheduler.query_scheduler(runner=runner)
        self.assertIn("Hermes-MeuPlantao-Dispatcher", seen["args"])

    def test_missing_task_reports_not_exists(self):
        def boom(*a, **k):
            raise RuntimeError("ERROR: The system cannot find the file specified.")
        info = windows_scheduler.query_scheduler(runner=boom)
        self.assertFalse(info["exists"])
        self.assertIn("error", info)

    def test_runner_error_reports_error(self):
        def boom(*a, **k):
            raise RuntimeError("scheduler service unavailable")
        info = windows_scheduler.query_scheduler(runner=boom)
        self.assertFalse(info.get("enabled", False))
        self.assertIn("error", info)

if __name__ == "__main__":
    unittest.main()
