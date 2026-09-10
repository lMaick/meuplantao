import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import control_service

WT = "C:/worktrees/MAI-68"


def _deps(**over):
    base = {
        "get_mode": lambda: "AUTO",
        "set_mode": lambda m: m,
        "query_scheduler": lambda: {"exists": True, "enabled": True, "status": "Ready", "nextRun": "10:05"},
        "check_config": lambda: (True, ""),
        "check_orca": lambda: True,
        "list_agents": lambda: [],
        "get_agent_states": lambda: [],
        "read_state": lambda: {"runtime": {"lastCheck": 1, "lastResult": "ok"}, "issues": {}},
        "run_dispatcher": lambda args: {"returncode": 0, "output": "ok"},
        "read_logs": lambda n=50: ["line1", "line2"],
        "acquire_tick_lock": lambda timeout=120.0: ("fake-lock",),
        "release_tick_lock": lambda handle: None,
    }
    base.update(over)
    return base


def _terminal(handle, path=WT):
    return {"handle": handle, "worktreePath": path, "agentIdentity": "codex", "connected": True, "writable": True, "orphaned": False}


def _agent(state, path=WT, pane="pane1"):
    return {"worktree": path, "pane": pane, "state": state, "agentType": "codex"}


class AgentStateContractTests(unittest.TestCase):
    def test_connected_pane_with_done_agent_is_not_executing(self):
        d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda: [_agent("done")])
        status = control_service.get_status(d)
        self.assertEqual(status["visual"], "ATIVO")
        self.assertEqual(status["agents"], 0)
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["agentStates"]["idle"], 1)

    def test_working_agent_is_executing(self):
        d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda: [_agent("working")])
        status = control_service.get_status(d)
        self.assertEqual(status["visual"], "EXECUTANDO")
        self.assertEqual(status["agents"], 1)

    def test_mixed_working_and_done_is_executing_once(self):
        d = _deps(
            list_agents=lambda: [_terminal("h1"), _terminal("h2")],
            get_agent_states=lambda: [_agent("working", pane="p1"), _agent("done", pane="p2")],
        )
        status = control_service.get_status(d)
        self.assertEqual(status["visual"], "EXECUTANDO")
        self.assertEqual(status["agents"], 1)

    def test_waiting_idle_failed_are_not_executing(self):
        for state, key in (("waiting", "waiting"), ("idle", "idle"), ("failed", "failed")):
            with self.subTest(state=state):
                d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda s=state: [_agent(s)])
                status = control_service.get_status(d)
                self.assertEqual(status["visual"], "ATIVO")
                self.assertEqual(status["agentStates"][key], 1)

    def test_classify_mapping(self):
        cases = {
            "working": "EXECUTANDO",
            " Working ": "EXECUTANDO",
            "waiting": "AGUARDANDO",
            "done": "OCIOSO",
            "idle": "OCIOSO",
            "failed": "FALHA",
            None: "DESCONHECIDO",
            "": "DESCONHECIDO",
            "bogus-state": "DESCONHECIDO",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(control_service.classify_agent_state(raw), expected)

    def test_missing_structured_payload_falls_back_fail_closed(self):
        d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda: None)
        status = control_service.get_status(d)
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "EXECUTANDO")

    def test_malformed_structured_payload_falls_back_fail_closed(self):
        for payload in ("garbage", 42, {"unexpected": True}, [{"handle": "h1"}]):
            with self.subTest(payload=payload):
                d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda p=payload: p)
                status = control_service.get_status(d)
                if payload == [{"handle": "h1"}]:
                    self.assertTrue(status["structuredOk"])
                    self.assertEqual(status["visual"], "ATIVO")
                else:
                    self.assertFalse(status["structuredOk"])
                    self.assertEqual(status["visual"], "EXECUTANDO")

    def test_structured_provider_error_falls_back_fail_closed(self):
        def boom():
            raise RuntimeError("orca 1.3 sem estado estruturado")
        d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=boom)
        status = control_service.get_status(d)
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "EXECUTANDO")

    def test_raw_worktree_ps_shape_is_coerced(self):
        payload = {"worktrees": [{"path": WT, "agents": [{"paneKey": "pk1", "state": "done", "agentType": "codex"}]}]}
        d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda: payload)
        status = control_service.get_status(d)
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["visual"], "ATIVO")

    def test_multiple_writable_panes_flagged_without_closing(self):
        seen = {}
        d = _deps(
            list_agents=lambda: [_terminal("h1"), _terminal("h2")],
            get_agent_states=lambda: [_agent("done", pane="p1"), _agent("done", pane="p2")],
            set_mode=lambda m: seen.update(mode=m) or m,
        )
        status = control_service.get_status(d)
        self.assertEqual(status["visual"], "ATIVO")
        self.assertEqual(len(status["duplicateAgents"]), 1)
        self.assertIn("nenhum pane foi fechado automaticamente", status["warning"])
        self.assertIn("nenhum pane foi fechado automaticamente", status["message"])
        msg = control_service.pause(d)
        self.assertEqual(seen["mode"], "PAUSED")
        self.assertNotIn("close", msg.lower())
        self.assertNotIn("kill", msg.lower())

    def test_pause_with_done_panes_uses_simple_message(self):
        d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda: [_agent("done")])
        msg = control_service.pause(d)
        self.assertEqual(msg, "Dispatcher pausado para novas tarefas.")

    def test_pause_with_working_agent_keeps_extended_message(self):
        d = _deps(list_agents=lambda: [_terminal("h1")], get_agent_states=lambda: [_agent("working")])
        msg = control_service.pause(d)
        self.assertIn("execucao atual nao foi interrompida", msg.lower().replace("ç", "c").replace("ã", "a"))


if __name__ == "__main__":
    unittest.main()
