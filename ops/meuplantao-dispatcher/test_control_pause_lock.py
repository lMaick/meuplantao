import os
import sys
import tempfile
import threading
import time
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import control_service
import dispatcher_home

try:
    import msvcrt
    HAS_MSVCRT = True
except ImportError:
    HAS_MSVCRT = False

@unittest.skipUnless(HAS_MSVCRT, "requires Windows msvcrt file lock")
class PauseLockCoordinationTests(unittest.TestCase):
    def _env(self, home):
        env = dict(os.environ)
        env["MEUPLANTAO_DISPATCHER_HOME"] = str(home)
        env.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
        return env

    def test_pause_waits_for_tick_lock_then_confirms_paused(self):
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            held = threading.Event()
            release = threading.Event()
            def fake_tick():
                handle = dispatcher_home.acquire_tick_lock(home / "dispatcher.lock", timeout=10)
                try:
                    held.set()
                    release.wait(timeout=15)
                finally:
                    dispatcher_home.release_tick_lock(handle)
            tick = threading.Thread(target=fake_tick, daemon=True)
            tick.start()
            self.assertTrue(held.wait(timeout=10))
            agents = [{"handle": "h1", "agentIdentity": "codex"}]
            with unittest.mock.patch.dict(os.environ, self._env(home), clear=True):
                start = time.monotonic()
                release.set()
                msg = control_service.pause({"list_agents": lambda: agents})
                elapsed = time.monotonic() - start
            tick.join(timeout=15)
            self.assertIn("n\u00e3o foi interrompida", msg)
            from control_state import get_mode
            self.assertEqual(get_mode(home / "control-state.json"), "PAUSED")
            self.assertGreaterEqual(elapsed, 0.0)
            handle = dispatcher_home.acquire_tick_lock(home / "dispatcher.lock", timeout=10)
            try:
                self.assertEqual(get_mode(home / "control-state.json"), "PAUSED")
            finally:
                dispatcher_home.release_tick_lock(handle)

    def test_pause_blocks_while_tick_holds_lock(self):
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            held = threading.Event()
            release = threading.Event()
            order = []
            def fake_tick():
                handle = dispatcher_home.acquire_tick_lock(home / "dispatcher.lock", timeout=10)
                try:
                    held.set()
                    self.assertTrue(release.wait(timeout=15))
                    time.sleep(1.0)
                    order.append("tick-released")
                finally:
                    dispatcher_home.release_tick_lock(handle)
            tick = threading.Thread(target=fake_tick, daemon=True)
            tick.start()
            self.assertTrue(held.wait(timeout=10))
            with unittest.mock.patch.dict(os.environ, self._env(home), clear=True):
                release.set()
                start = time.monotonic()
                control_service.pause({"list_agents": lambda: []})
                elapsed = time.monotonic() - start
            tick.join(timeout=15)
            self.assertEqual(order, ["tick-released"])
            self.assertGreaterEqual(elapsed, 1.0)

    def test_pause_timeout_never_confirms(self):
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            handle = dispatcher_home.acquire_tick_lock(home / "dispatcher.lock", timeout=10)
            try:
                with unittest.mock.patch.dict(os.environ, self._env(home), clear=True):
                    with self.assertRaises(RuntimeError):
                        control_service.pause({"list_agents": lambda: [], "lock_timeout": 0.5})
                self.assertFalse((home / "control-state.json").exists())
            finally:
                dispatcher_home.release_tick_lock(handle)

if __name__ == "__main__":
    unittest.main()
