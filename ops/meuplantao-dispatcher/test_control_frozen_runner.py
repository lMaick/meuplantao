import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import control_service
FAKE_EXE = "C:/fake/dist/MaickDispatcherControl.exe"


def _make_home(with_wrapper=True, with_script=True):
    import tempfile
    d = tempfile.TemporaryDirectory()
    home = Path(d.name)
    if with_script:
        (home / "dispatcher.py").write_text("# fake engine outside bundle\n", encoding="utf-8")
    if with_wrapper:
        (home / "run-dispatcher.cmd").write_text("@echo off\r\nexit /b 0\r\n", encoding="utf-8")
    return d, home


def _svc(runner):
    return {
        "get_mode": lambda: "AUTO",
        "set_mode": lambda m: m,
        "query_scheduler": lambda: {},
        "check_config": lambda: (True, ""),
        "check_orca": lambda: True,
        "list_agents": lambda: [],
        "read_state": lambda: {},
        "run_dispatcher": runner,
        "read_logs": lambda n=50: [],
        "acquire_tick_lock": lambda timeout=120.0: None,
        "release_tick_lock": lambda h: None,
    }
class FrozenRunnerTests(unittest.TestCase):
    def test_red_frozen_never_uses_exe_as_python(self):
        keep, home = _make_home(with_wrapper=True)
        try:
            with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": str(home)}, clear=False):
                os.environ.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
                os.environ.pop("MEUPLANTAO_DISPATCHER_PYTHON", None)
                with unittest.mock.patch.object(sys, "executable", FAKE_EXE):
                    with unittest.mock.patch.object(sys, "frozen", True, create=True):
                        cmd = control_service.build_dispatcher_command()
            self.assertIn("--manual-once", cmd)
            lowered = [str(c).lower() for c in cmd]
            self.assertNotIn(FAKE_EXE.lower(), lowered)
            self.assertTrue(any("run-dispatcher.cmd" in c for c in lowered), cmd)
        finally:
            keep.cleanup()

    def test_final_command_prefers_wrapper(self):
        keep, home = _make_home(with_wrapper=True)
        try:
            with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": str(home)}, clear=False):
                os.environ.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
                os.environ.pop("MEUPLANTAO_DISPATCHER_PYTHON", None)
                cmd = control_service.build_dispatcher_command()
            self.assertIn("--manual-once", cmd)
            self.assertTrue(any("run-dispatcher.cmd" in str(c) for c in cmd), cmd)
        finally:
            keep.cleanup()
    def test_explicit_python_when_wrapper_missing(self):
        keep, home = _make_home(with_wrapper=False)
        try:
            env = {"MEUPLANTAO_DISPATCHER_HOME": str(home), "MEUPLANTAO_DISPATCHER_PYTHON": "C:/Python311/python.exe"}
            with unittest.mock.patch.dict(os.environ, env, clear=False):
                os.environ.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
                cmd = control_service.build_dispatcher_command()
            self.assertEqual(cmd[0], "C:/Python311/python.exe")
            self.assertIn("--manual-once", cmd)
            self.assertTrue(any(str(c).endswith("dispatcher.py") for c in cmd), cmd)
        finally:
            keep.cleanup()

    def test_frozen_without_wrapper_or_python_fails_closed(self):
        keep, home = _make_home(with_wrapper=False)
        try:
            with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": str(home)}, clear=True):
                with unittest.mock.patch.object(sys, "executable", FAKE_EXE):
                    with unittest.mock.patch.object(sys, "frozen", True, create=True):
                        with self.assertRaises(RuntimeError):
                            control_service.build_dispatcher_command()
                        captured = {}
                        def runner(args):
                            captured["args"] = list(args)
                            return {"returncode": 0, "output": "should not run"}
                        res = control_service.run_once(_svc(runner))
                        self.assertFalse(res["ok"])
                        self.assertNotIn("args", captured)
        finally:
            keep.cleanup()
    def test_run_once_never_falls_back_to_frozen_exe(self):
        keep, home = _make_home(with_wrapper=False)
        try:
            with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": str(home)}, clear=True):
                with unittest.mock.patch.object(sys, "executable", FAKE_EXE):
                    with unittest.mock.patch.object(sys, "frozen", True, create=True):
                        seen = {}
                        def runner(args):
                            seen["args"] = list(args)
                            return {"returncode": 0, "output": "ok"}
                        res = control_service.run_once(_svc(runner))
                        self.assertFalse(res["ok"])
                        for part in seen.get("args", []):
                            self.assertNotEqual(str(part).lower(), FAKE_EXE.lower())
        finally:
            keep.cleanup()

    def test_wrapper_error_fails_closed(self):
        keep, home = _make_home(with_wrapper=True)
        try:
            with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": str(home)}, clear=False):
                os.environ.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
                os.environ.pop("MEUPLANTAO_DISPATCHER_PYTHON", None)
                res = control_service.run_once(
                    _svc(lambda args: {"returncode": 1, "output": "wrapper boom"}))
                self.assertFalse(res["ok"])
                self.assertIn("wrapper boom", res["result"])
        finally:
            keep.cleanup()

    def test_missing_dispatcher_script_fails_closed(self):
        keep, home = _make_home(with_wrapper=True, with_script=False)
        try:
            with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": str(home)}, clear=False):
                os.environ.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
                with self.assertRaises(RuntimeError):
                    control_service.build_dispatcher_command()
        finally:
            keep.cleanup()


    def test_run_once_cli_reports_json_and_exit_code(self):
            import io
            import json
            import contextlib
            import control_app
            keep, home = _make_home(with_wrapper=True)
            try:
                with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": str(home)}, clear=False):
                    os.environ.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
                    os.environ.pop("MEUPLANTAO_DISPATCHER_PYTHON", None)
                    buf = io.StringIO()
                    with contextlib.redirect_stdout(buf):
                        code = control_app.main(["--run-once"])
                    payload = json.loads(buf.getvalue())
                self.assertEqual(code, 0)
                self.assertTrue(payload["ok"])
            finally:
                keep.cleanup()


if __name__ == "__main__":
    unittest.main()
