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
        import threading
        svc = FakeService()
        calls = []
        gate = threading.Event()
        def counting(deps=None):
            calls.append(1)
            gate.wait(timeout=10)
            return {"ok": True, "result": "done"}
        svc.run_once = counting
        app = control_app.ControlApp.__new__(control_app.ControlApp)
        app.service = svc
        app.message_label = type("L", (), {"text": ""})()
        app.root = FakeRoot()
        app._run_once_busy = False
        import queue as _q
        app._run_queue = _q.Queue()
        app.run_button = FakeButton()
        app.on_run_once()
        gate.set()
        app._poll_run_once()
        self.assertEqual(len(calls), 1)

    def test_run_once_is_non_blocking_and_reports_back(self):
        import threading, time
        svc = FakeService()
        started = threading.Event()
        release = threading.Event()
        def slow(deps=None):
            started.set()
            release.wait(timeout=10)
            return {"ok": True, "result": "done-async"}
        svc.run_once = slow
        app = control_app.ControlApp.__new__(control_app.ControlApp)
        app.service = svc
        app.message_label = FakeLabel()
        app.root = FakeRoot()
        import queue as _q
        app._run_queue = _q.Queue()
        app._run_once_busy = False
        app.run_button = FakeButton()
        begin = time.monotonic()
        app.on_run_once()
        waited = time.monotonic() - begin
        self.assertLess(waited, 2.0)
        self.assertTrue(started.wait(timeout=10))
        self.assertEqual(app.run_button.state, "disabled")
        release.set()
        deadline = time.monotonic() + 10
        while app._run_once_busy and time.monotonic() < deadline:
            app._poll_run_once()
            time.sleep(0.05)
        self.assertFalse(app._run_once_busy)
        self.assertEqual(app.run_button.state, "normal")
        self.assertIn("done-async", app.message_label.text)

    def test_double_click_does_not_start_second_run(self):
        import threading
        svc = FakeService()
        calls = []
        gate = threading.Event()
        def slow(deps=None):
            calls.append(1)
            gate.wait(timeout=10)
            return {"ok": True, "result": "done"}
        svc.run_once = slow
        app = control_app.ControlApp.__new__(control_app.ControlApp)
        app.service = svc
        app.message_label = FakeLabel()
        app.root = FakeRoot()
        import queue as _q
        app._run_queue = _q.Queue()
        app._run_once_busy = False
        app.run_button = FakeButton()
        app.on_run_once()
        app.on_run_once()
        gate.set()
        deadline = __import__("time").monotonic() + 10
        while app._run_once_busy and __import__("time").monotonic() < deadline:
            app._poll_run_once()
            __import__("time").sleep(0.05)
        self.assertEqual(len(calls), 1)


class FakeLabel:
    def __init__(self):
        self.text = ""
    def config(self, text=""):
        self.text = text

class FakeButton:
    def __init__(self):
        self.state = "normal"
    def config(self, state=None, **kwargs):
        if state is not None:
            self.state = state

class FakeRoot:
    def __init__(self):
        self.callbacks = []
    def after(self, ms, func):
        self.callbacks.append(func)
        return "timer"

if __name__ == "__main__":
    unittest.main()
