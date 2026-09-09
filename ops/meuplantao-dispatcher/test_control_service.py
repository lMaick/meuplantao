import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import control_service

def _deps(**over):
    base = {
        "get_mode": lambda: "AUTO",
        "set_mode": lambda m: m,
        "query_scheduler": lambda: {"exists": True, "enabled": True, "status": "Ready", "nextRun": "10:05"},
        "check_config": lambda: (True, ""),
        "check_orca": lambda: True,
        "list_agents": lambda: [],
        "read_state": lambda: {"runtime": {"lastCheck": 1, "lastResult": "ok"}, "issues": {}},
        "run_dispatcher": lambda args: {"returncode": 0, "output": "ok"},
        "read_logs": lambda n=50: ["line1", "line2"],
    }
    base.update(over)
    return base

class ControlServiceTests(unittest.TestCase):
    def test_pause_with_active_agent_does_not_kill(self):
        calls = []
        def fake_runner(*a, **k):
            calls.append(a)
            raise AssertionError("must not touch agents")
        d = _deps(list_agents=lambda: [{"handle": "h1"}], set_mode=lambda m: m)
        msg = control_service.pause(d)
        self.assertIn("execucao atual nao foi interrompida", msg.lower().replace("ç", "c").replace("ã", "a"))
        self.assertNotIn("close", str(calls).lower())
        self.assertNotIn("kill", str(calls).lower())

    def test_pause_persists_and_keeps_monitor(self):
        seen = {}
        d = _deps(set_mode=lambda m: seen.update(mode=m) or m, list_agents=lambda: [])
        control_service.pause(d)
        self.assertEqual(seen["mode"], "PAUSED")

    def test_resume_persists_auto(self):
        seen = {}
        d = _deps(set_mode=lambda m: seen.update(mode=m) or m)
        control_service.resume(d)
        self.assertEqual(seen["mode"], "AUTO")

    def test_run_once_dispatches_at_most_once(self):
        got = {}
        def runner(args):
            got["args"] = args
            return {"returncode": 0, "output": "ok"}
        d = _deps(run_dispatcher=runner)
        control_service.run_once(d)
        self.assertIn("--manual-once", got["args"])

    def test_run_once_with_active_lock_is_safe_skip(self):
        d = _deps(run_dispatcher=lambda args: {"returncode": 0, "output": "Another dispatcher run owns the lock; skipping"})
        res = control_service.run_once(d)
        self.assertIn("skip", res["result"].lower())

    def test_status_error_on_bad_config_or_scheduler(self):
        s1 = control_service.get_status(_deps(check_config=lambda: (False, "missing config")))
        self.assertEqual(s1["visual"], "ERRO")
        s2 = control_service.get_status(_deps(query_scheduler=lambda: {"exists": False, "enabled": False, "status": "Missing"}))
        self.assertEqual(s2["visual"], "ERRO")
        s3 = control_service.get_status(_deps(query_scheduler=lambda: {"exists": True, "enabled": False, "status": "Disabled"}))
        self.assertEqual(s3["visual"], "ERRO")

    def test_status_shows_states_from_disk(self):
        self.assertEqual(control_service.get_status(_deps(get_mode=lambda: "AUTO"))["visual"], "ATIVO")
        self.assertEqual(control_service.get_status(_deps(get_mode=lambda: "PAUSED"))["visual"], "PAUSADO")
        self.assertEqual(control_service.get_status(_deps(get_mode=lambda: "AUTO", list_agents=lambda: [{"handle": "h"}]))["visual"], "EXECUTANDO")

    def test_logs_show_last_n_lines(self):
        d = _deps(read_logs=lambda n=50: [f"l{i}" for i in range(100)][-n:])
        lines = control_service.last_logs(d, 10)
        self.assertEqual(len(lines), 10)
        self.assertEqual(lines[-1], "l99")

    def test_status_sanitizes_secrets(self):
        s = control_service.get_status(_deps(read_state=lambda: {"runtime": {"lastResult": "ok"}}))
        blob = str(s)
        self.assertNotIn("ghp_", blob)
        self.assertNotIn("token", blob.lower().replace("accessible", ""))

if __name__ == "__main__":
    unittest.main()
