import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import control_app

class FakeService:
    def __init__(self):
        self.mode = "AUTO"
        self.status_calls = 0
    def get_status(self, deps=None):
        self.status_calls += 1
        visual = "PAUSADO" if self.mode == "PAUSED" else "ATIVO"
        return {"visual": visual, "mode": self.mode, "scheduler": {"exists": True, "enabled": True}, "configOk": True, "orcaOk": True, "runtime": {"lastResult": "ok"}}
    def pause(self, deps=None):
        self.mode = "PAUSED"
        return "pausado"
    def resume(self, deps=None):
        self.mode = "AUTO"
        return "ativado"
    def run_once(self, deps=None):
        return {"ok": True, "result": "done"}
    def last_logs(self, deps=None, n=50):
        return ["a", "b"]

class ControlAppTests(unittest.TestCase):
    def test_refresh_rereads_status_from_disk(self):
        svc = FakeService()
        app = control_app.ControlApp.__new__(control_app.ControlApp)
        app.service = svc
        app.state_label = type("L", (), {"text": ""})()
        app.refresh()
        app.refresh()
        self.assertEqual(svc.status_calls, 2)
        self.assertEqual(app.state_label.text, "ATIVO")
        svc.mode = "PAUSED"
        app.refresh()
        self.assertEqual(app.state_label.text, "PAUSADO")

    def test_pause_and_resume_delegate_to_service(self):
        svc = FakeService()
        app = control_app.ControlApp.__new__(control_app.ControlApp)
        app.service = svc
        app.state_label = type("L", (), {"text": ""})()
        app.message_label = type("L", (), {"text": ""})()
        app.on_pause()
        self.assertEqual(svc.mode, "PAUSED")
        app.on_resume()
        self.assertEqual(svc.mode, "AUTO")

    def test_restart_shows_real_persisted_state(self):
        svc = FakeService()
        svc.mode = "PAUSED"
        app = control_app.ControlApp.__new__(control_app.ControlApp)
        app.service = svc
        app.state_label = type("L", (), {"text": ""})()
        app.refresh()
        self.assertEqual(app.state_label.text, "PAUSADO")

    def test_run_once_delegates_single_iteration(self):
        svc = FakeService()
        calls = []
        orig = svc.run_once
        def counting(deps=None):
            calls.append(1)
            return orig(deps)
        svc.run_once = counting
        app = control_app.ControlApp.__new__(control_app.ControlApp)
        app.service = svc
        app.message_label = type("L", (), {"text": ""})()
        app.on_run_once()
        self.assertEqual(len(calls), 1)

if __name__ == "__main__":
    unittest.main()
