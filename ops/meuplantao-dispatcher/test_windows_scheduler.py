import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import windows_scheduler

XML_OK = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><TimeTrigger><Repetition><Interval>PT5M</Interval></Repetition></TimeTrigger></Triggers>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><ExecutionTimeLimit>PT15M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
</Task>"""

XML_DISABLED = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Settings><ExecutionTimeLimit>PT15M</ExecutionTimeLimit><Enabled>false</Enabled></Settings>
</Task>"""

LIST_EN = """HostName:      MYPC
TaskName:      \\Hermes-MeuPlantao-Dispatcher
Next Run Time: 9/9/2026 10:05:00 AM
Status:        Ready
Last Run Time: 9/9/2026 10:00:00 AM
"""

LIST_PT = """Nome do Host:       MEUPC
Nome da Tarefa:     \\Hermes-MeuPlantao-Dispatcher
Pr\u00f3xima Execu\u00e7\u00e3o: 09/09/2026 10:05:00
Status:             Pronto
\u00daltima Execu\u00e7\u00e3o:  09/09/2026 10:00:00
"""

def _runner_for(xml, lst):
    def run(*args, **kwargs):
        if "/XML" in args:
            return xml
        return lst
    return run

class SchedulerTests(unittest.TestCase):
    def test_default_task_name_is_real_operational_task(self):
        self.assertEqual(windows_scheduler.TASK_NAME, "Hermes-MeuPlantao-Dispatcher")

    def test_task_name_override_is_honored_without_altering_task(self):
        seen = {}
        def runner(*args, **kwargs):
            seen["args"] = list(args)
            if "/XML" in args:
                return XML_OK
            return LIST_EN
        windows_scheduler.query_scheduler(runner=runner, task_name="Custom-Task")
        self.assertIn("Custom-Task", seen["args"])
        self.assertNotIn("/Create", seen["args"])
        self.assertNotIn("/Change", seen["args"])
        self.assertNotIn("/Delete", seen["args"])

    def test_default_resolves_from_dispatcher_config(self):
        import dispatcher
        self.assertEqual(dispatcher.SCHEDULER_TASK_NAME, "Hermes-MeuPlantao-Dispatcher")

    def test_english_and_portuguese_list_parse_identically(self):
        en = windows_scheduler.query_scheduler(runner=_runner_for(XML_OK, LIST_EN))
        pt = windows_scheduler.query_scheduler(runner=_runner_for(XML_OK, LIST_PT))
        for info in (en, pt):
            self.assertTrue(info["exists"])
            self.assertTrue(info["enabled"])
        self.assertEqual(en["lastRun"], "9/9/2026 10:00:00 AM")
        self.assertEqual(en["nextRun"], "9/9/2026 10:05:00 AM")
        self.assertEqual(pt["lastRun"], "09/09/2026 10:00:00")
        self.assertEqual(pt["nextRun"], "09/09/2026 10:05:00")
        self.assertEqual(en["interval"], "PT5M")
        self.assertEqual(en["timeLimit"], "PT15M")

    def test_disabled_xml_reports_not_enabled(self):
        info = windows_scheduler.query_scheduler(runner=_runner_for(XML_DISABLED, LIST_EN))
        self.assertTrue(info["exists"])
        self.assertFalse(info["enabled"])

    def test_unparseable_xml_is_error(self):
        info = windows_scheduler.query_scheduler(runner=_runner_for("<<<not xml>>>", LIST_EN))
        self.assertFalse(info["exists"])
        self.assertFalse(info["enabled"])
        self.assertIn("error", info)

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
