import ast
import sys
from pathlib import Path
import tempfile
import unittest
import unittest.mock

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher_home

class DispatcherHomeTests(unittest.TestCase):
    def test_home_honors_explicit_home_env(self):
        import os
        with tempfile.TemporaryDirectory() as d:
            with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": d}, clear=False):
                os.environ.pop("MEUPLANTAO_DISPATCHER_CONFIG", None)
                self.assertEqual(dispatcher_home.home(), Path(d))

    def test_home_derives_from_config_parent(self):
        import os
        with tempfile.TemporaryDirectory() as d:
            cfg = str(Path(d) / "sub" / "config.toml")
            env = {"MEUPLANTAO_DISPATCHER_CONFIG": cfg}
            with unittest.mock.patch.dict(os.environ, env, clear=False):
                os.environ.pop("MEUPLANTAO_DISPATCHER_HOME", None)
                self.assertEqual(dispatcher_home.home(), Path(d) / "sub")

    def test_frozen_without_env_fails_closed(self):
        import os
        with unittest.mock.patch.object(sys, "frozen", True, create=True):
            with unittest.mock.patch.dict(os.environ, {}, clear=True):
                with self.assertRaises(RuntimeError):
                    dispatcher_home.home()

    def test_frozen_with_env_never_uses_temp_meipass(self):
        import os
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as meipass:
            with unittest.mock.patch.object(sys, "frozen", True, create=True):
                sys._MEIPASS = meipass
                try:
                    with unittest.mock.patch.dict(os.environ, {"MEUPLANTAO_DISPATCHER_HOME": d}, clear=True):
                        resolved = dispatcher_home.home()
                        self.assertEqual(resolved, Path(d))
                        self.assertNotEqual(resolved, Path(meipass))
                finally:
                    del sys._MEIPASS

    def test_load_config_dict_validates_required_and_placeholders(self):
        with tempfile.TemporaryDirectory() as d:
            good = Path(d) / "config.toml"
            good.write_text("orca_dir = \"C:/orca\"\ngh_executable = \"\"\ngithub_repo = \"o/r\"\nrepo_name = \"r\"\nrepo_path = \"p\"\nworktree_root = \"w\"\nlinear_workspace_id = \"x\"\nteam = \"t\"\nproject = \"p\"\n", encoding="utf-8")
            cfg = dispatcher_home.load_config_dict(good)
            self.assertEqual(cfg["team"], "t")
            bad = Path(d) / "bad.toml"
            bad.write_text("team = \"only\"\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                dispatcher_home.load_config_dict(bad)

    def test_control_modules_never_import_dispatcher(self):
        root = Path(__file__).parent
        for name in ("control_state.py", "control_service.py", "windows_scheduler.py", "dispatcher_home.py", "control_app.py"):
            tree = ast.parse((root / name).read_text(encoding="utf-8-sig"))
            imports = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.update(a.name.split(".")[0] for a in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.add(node.module.split(".")[0])
            self.assertNotIn("dispatcher", imports, name)

if __name__ == "__main__":
    unittest.main()
