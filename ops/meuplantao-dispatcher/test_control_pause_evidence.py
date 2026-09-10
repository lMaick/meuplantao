import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import control_service
import dispatcher_home
import control_state

SCOPE = {"hostIds": ["host-1"], "omittedHostIds": []}
WORKTREES = {'worktrees': [{'id': 'wt-66', 'repo': 'meuplantao', 'repoId': 'repo-meuplantao', 'path': 'C:/work/MAI-66-ctrl', 'displayName': 'MAI-66-ctrl', 'linkedLinearIssue': 'MAI-66'}], 'hostScope': SCOPE, 'totalCount': 1, 'truncated': False}
TERMINALS = {"terminals": [{"handle": "term-66", "agentIdentity": "codex"}], "hostScope": SCOPE, "totalCount": 1, "truncated": False}

class PauseEvidenceTests(unittest.TestCase):
    def test_pause_with_live_agent_keeps_agent_and_touches_nothing_destructive(self):
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            commands = []
            def fake_orca_run(*args, **kwargs):
                commands.append(list(args))
                if tuple(args[:2]) == ("worktree", "list"):
                    return WORKTREES
                if tuple(args[:2]) == ("terminal", "list"):
                    return TERMINALS
                raise AssertionError(f"unexpected orca call: {args}")
            with unittest.mock.patch.object(control_service, "_orca_run", side_effect=fake_orca_run):
                with unittest.mock.patch.object(dispatcher_home, "load_config_dict", return_value={"repo_name": "meuplantao"}):
                    before = control_service._list_agents_real()
            self.assertEqual([a["handle"] for a in before], ["term-66"])
            deps = {
                "list_agents": control_service._list_agents_real,
                "set_mode": lambda mode: control_state.set_mode(mode, home / "control-state.json"),
                "acquire_tick_lock": lambda timeout=120.0: dispatcher_home.acquire_tick_lock(home / "dispatcher.lock", timeout=timeout),
                "release_tick_lock": dispatcher_home.release_tick_lock,
            }
            with unittest.mock.patch.object(control_service, "_orca_run", side_effect=fake_orca_run):
                with unittest.mock.patch.object(dispatcher_home, "load_config_dict", return_value={"repo_name": "meuplantao"}):
                    msg = control_service.pause(deps)
                    after = control_service._list_agents_real()
            self.assertEqual(msg, control_service.PAUSE_MESSAGE)
            self.assertEqual([a["handle"] for a in after], ["term-66"])
            self.assertEqual(control_state.get_mode(home / "control-state.json"), "PAUSED")
            destructive = [c for c in commands if any(v in ("close", "delete", "kill", "stop", "taskkill", "/delete") for v in [str(x).lower() for x in c])]
            self.assertEqual(destructive, [])
            verbs = sorted({str(c[1]).lower() for c in commands if len(c) > 1})
            self.assertIn("list", verbs)

if __name__ == "__main__":
    unittest.main()
