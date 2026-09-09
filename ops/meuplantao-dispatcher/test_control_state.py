import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import control_state

class ControlStateTests(unittest.TestCase):
    def test_missing_file_defaults_auto_when_config_valid(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(control_state.get_mode(Path(d) / "control-state.json", lambda: True), "AUTO")

    def test_missing_file_fails_closed_when_config_invalid(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):
                control_state.get_mode(Path(d) / "control-state.json", lambda: False)

    def test_active_to_paused_and_back_is_persistent(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "control-state.json"
            control_state.set_mode("PAUSED", p)
            self.assertEqual(control_state.get_mode(p, lambda: True), "PAUSED")
            control_state.set_mode("AUTO", p)
            self.assertEqual(control_state.get_mode(p, lambda: True), "AUTO")

    def test_invalid_mode_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "control-state.json"
            p.write_text("{\"mode\": \"MANUAL\"}", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                control_state.get_mode(p, lambda: True)

    def test_corrupt_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "control-state.json"
            p.write_text("not-json", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                control_state.get_mode(p, lambda: True)

    def test_restart_preserves_real_state(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "control-state.json"
            control_state.set_mode("PAUSED", p)
            self.assertEqual(control_state.get_mode(p, lambda: True), "PAUSED")

if __name__ == "__main__":
    unittest.main()
