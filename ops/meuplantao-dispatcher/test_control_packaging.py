import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).parent
REPO = ROOT.parent.parent

class PackagingTests(unittest.TestCase):
    def test_gitignore_covers_runtime_and_bundle(self):
        ops_ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        for token in ("control-state.json", "state.json", "dispatcher.log", "dispatcher.lock", "config.toml", "dist/", "build/"):
            self.assertIn(token, ops_ignore)

    def test_tracked_tree_has_no_runtime_artifacts(self):
        import subprocess
        out = subprocess.run(["git", "ls-files", "ops/meuplantao-dispatcher"], capture_output=True, text=True, encoding="utf-8", errors="replace")
        files = out.stdout.split()
        banned = ("config.toml", "state.json", "dispatcher.log", "dispatcher.lock", "control-state.json", ".exe", "dist/", "build/")
        for f in files:
            if f.endswith(".example.toml"):
                continue
            for b in banned:
                self.assertNotIn(b, f, f)

    def test_no_secrets_in_sources(self):
        for p in ROOT.glob("*.py"):
            if p.name.startswith("test_"):
                continue
            text = p.read_text(encoding="utf-8")
            low = text.lower()
            self.assertNotIn("ghp" + "_", low, p.name)
            self.assertNotIn("github" + "_token", low, p.name)
            self.assertNotIn("supabase" + "_service", low, p.name)

    def test_build_script_produces_versioned_exe_path(self):
        script = (ROOT / "build-control-app.ps1").read_text(encoding="utf-8")
        self.assertIn("MaickDispatcherControl.exe", script)
        self.assertIn("PyInstaller", script)

    def test_ci_discovers_all_control_tests(self):
        ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("test_", ci)
        self.assertNotIn("test_dispatcher.py\"\n", ci.replace(" ", ""))

if __name__ == "__main__":
    unittest.main()
