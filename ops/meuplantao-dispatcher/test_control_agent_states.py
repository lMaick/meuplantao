import sys
from pathlib import Path
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import control_service

WT1 = "C:/worktrees/MAI-68-a"
WT2 = "C:/worktrees/MAI-68-b"


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


def _raw_terminal(handle, agent="codex", orphaned=False, **extra):
    term = {"handle": handle, "agentIdentity": agent, "connected": True, "writable": True, "orphaned": orphaned}
    term.update(extra)
    return term


def _orca_side_effect(worktrees, terminals_by_path):
    def fake(*args, **kwargs):
        if tuple(args[:2]) == ("worktree", "list"):
            return {"worktrees": worktrees}
        if tuple(args[:2]) == ("terminal", "list"):
            selector = next((a for a in args if isinstance(a, str) and a.startswith("path:")), "")
            result = terminals_by_path.get(selector[len("path:"):], [])
            if isinstance(result, Exception):
                raise result
            return {"terminals": result}
        raise AssertionError(f"unexpected orca call: {args}")
    return fake


def _discovered(worktrees, terminals_by_path):
    import dispatcher_home
    with mock.patch.object(control_service, "_orca_run", side_effect=_orca_side_effect(worktrees, terminals_by_path)):
        with mock.patch.object(dispatcher_home, "load_config_dict", return_value={"repo_name": "meuplantao"}):
            return control_service._list_agents_real()


def _structured_done(path, pane):
    return {"worktree": path, "pane": pane, "state": "done", "agentType": "codex"}


class StrictCoercionTests(unittest.TestCase):
    def test_valid_shapes_accepted(self):
        self.assertEqual(control_service._coerce_structured_states([]), [])
        self.assertEqual(control_service._coerce_structured_states({"agents": []}), [])
        self.assertEqual(control_service._coerce_structured_states({"worktrees": []}), [])
        payload = {"worktrees": [
            {"path": WT1, "agents": [
                {"paneKey": "p1", "state": "working", "agentType": "codex"},
                {"paneKey": "p2", "state": "waiting", "agentType": "codex"},
            ]},
            {"path": WT2, "agents": [
                {"paneKey": "p3", "state": "done", "agentType": "codex"},
                {"paneKey": "p4", "state": "idle", "agentType": "codex"},
                {"paneKey": "p5", "state": "failed", "agentType": "codex"},
            ]},
        ]}
        result = control_service._coerce_structured_states(payload)
        self.assertEqual(len(result), 5)
        self.assertEqual(result[0]["worktree"], WT1)
        self.assertEqual(result[0]["pane"], "p1")
        summary = control_service.summarize_agent_states(result)
        self.assertEqual((summary["active"], summary["waiting"], summary["idle"], summary["failed"]), (1, 1, 2, 1))

    def test_absent_or_scalar_rejected(self):
        for payload in (None, "garbage", 42, 3.5, True, {}, {"unexpected": True}):
            with self.subTest(payload=payload):
                self.assertIsNone(control_service._coerce_structured_states(payload))

    def test_invalid_containers_rejected(self):
        bad = [
            {"worktrees": "x"},
            {"worktrees": {}},
            {"worktrees": [42]},
            {"worktrees": ["x"]},
            {"worktrees": [{"path": WT1}]},
            {"worktrees": [{"path": WT1, "agents": "x"}]},
            {"worktrees": [{"path": WT1, "agents": {}}]},
            {"worktrees": [{"path": WT1, "agents": [42]}]},
            {"worktrees": [{"agents": []}] + [42]},
            {"agents": "x"},
            {"agents": [42]},
            [["working"]],
            [42],
            ["working"],
        ]
        for payload in bad:
            with self.subTest(payload=payload):
                self.assertIsNone(control_service._coerce_structured_states(payload))

    def test_missing_empty_unknown_state_rejected(self):
        bad = [
            [{"handle": "h1"}],
            [{"state": None}],
            [{"state": ""}],
            [{"state": "   "}],
            [{"state": "bogus-state"}],
            [{"state": "working"}, {"state": "bogus-state"}],
            [{"worktree": WT1, "pane": "p1", "state": "working"}, {"worktree": WT1, "pane": "p2"}],
            {"agents": [{"handle": "h1", "state": "done"}, {"handle": "h2"}]},
            {"worktrees": [{"path": WT1, "agents": [{"paneKey": "p1"}]}]},
            {"worktrees": [{"path": WT1, "agents": [{"paneKey": "p1", "state": "paused"}]}]},
        ]
        for payload in bad:
            with self.subTest(payload=payload):
                self.assertIsNone(control_service._coerce_structured_states(payload))

    def test_case_and_whitespace_state_accepted(self):
        result = control_service._coerce_structured_states([{"worktree": WT1, "pane": "p1", "state": " Working ", "agentType": " Codex "}])
        self.assertIsNotNone(result)
        self.assertEqual(control_service.summarize_agent_states(result)["active"], 1)

    def test_invalid_worktree_pane_agenttype_shapes_rejected(self):
        bad = [
            [{"worktree": 42, "pane": [], "state": "working", "agentType": "codex"}],
            [{"worktree": WT1, "pane": "p1", "state": "working", "agentType": "claude"}],
            [{"worktree": WT1, "pane": "p1", "state": "working"}],
            [{"worktree": WT1, "pane": "p1", "state": "working", "agentType": 42}],
            [{"worktree": WT1, "pane": "p1", "state": "working", "agentType": ""}],
            [{"worktree": "", "pane": "p1", "state": "working", "agentType": "codex"}],
            [{"worktree": WT1, "pane": 42, "state": "working", "agentType": "codex"}],
            [{"worktree": WT1, "pane": "   ", "state": "working", "agentType": "codex"}],
            {"worktrees": [{"path": WT1, "agents": [{"paneKey": "p1", "state": "done"}]}]},
            {"worktrees": [{"path": WT1, "agents": [{"paneKey": "p1", "state": "done", "agentType": "claude"}]}]},
            {"agents": [{"worktree": WT1, "pane": "p1", "state": "done", "agentType": None}]},
        ]
        for payload in bad:
            with self.subTest(payload=payload):
                self.assertIsNone(control_service._coerce_structured_states(payload))

    def test_malformed_done_never_masks_legacy_activity(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        payloads = (
            {"worktrees": [{"path": WT1, "agents": [{"paneKey": "p1", "state": "done"}]}]},
            [{"worktree": WT1, "pane": "p1", "state": "done", "agentType": "claude"}],
            [{"worktree": 42, "pane": [], "state": "done", "agentType": "codex"}],
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                d = _deps(list_agents=lambda: agents, get_agent_states=lambda p=payload: p)
                status = control_service.get_status(d)
                self.assertFalse(status["structuredOk"])
                self.assertEqual(status["visual"], "EXECUTANDO")
                self.assertGreater(status["agents"], 0)


class StatusFailClosedTests(unittest.TestCase):
    def test_done_connected_is_idle_not_executing(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: [_structured_done(WT1, "p1")])
        status = control_service.get_status(d)
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["visual"], "ATIVO")
        self.assertEqual(status["agents"], 0)

    def test_working_connected_is_executing(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: [{"worktree": WT1, "pane": "p1", "state": "working", "agentType": "codex"}])
        status = control_service.get_status(d)
        self.assertEqual(status["visual"], "EXECUTANDO")
        self.assertEqual(status["agents"], 1)

    def test_unknown_state_falls_back_to_legacy_executing(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: [{"worktree": WT1, "pane": "p1", "state": "paused", "agentType": "codex"}])
        status = control_service.get_status(d)
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "EXECUTANDO")

    def test_malformed_payloads_fall_back_to_legacy_executing(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        bad = ("garbage", 42, {"unexpected": True}, [{"handle": "h1"}], [{"state": ""}], {"worktrees": [{"path": WT1}]}, {"worktrees": [{"path": WT1, "agents": [42]}]})
        for payload in bad:
            with self.subTest(payload=payload):
                d = _deps(list_agents=lambda: agents, get_agent_states=lambda p=payload: p)
                status = control_service.get_status(d)
                self.assertFalse(status["structuredOk"])
                self.assertEqual(status["visual"], "EXECUTANDO")

    def test_missing_payload_and_provider_error_fall_back(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: None)
        self.assertEqual(control_service.get_status(d)["visual"], "EXECUTANDO")

        def boom():
            raise RuntimeError("orca 1.3 sem estado estruturado")
        d = _deps(list_agents=lambda: agents, get_agent_states=boom)
        status = control_service.get_status(d)
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "EXECUTANDO")

    def test_legacy_failure_without_structured_is_error(self):
        def boom():
            raise RuntimeError("terminal list failed")
        for payload in ([{"handle": "h1"}], [{"state": "bogus-state"}], "garbage", None):
            with self.subTest(payload=payload):
                d = _deps(list_agents=boom, get_agent_states=lambda p=payload: p)
                status = control_service.get_status(d)
                self.assertFalse(status["structuredOk"])
                self.assertEqual(status["visual"], "ERRO")
                self.assertIn("fail-closed", status.get("error", ""))

    def test_valid_structured_decides_even_when_legacy_fails(self):
        def boom():
            raise RuntimeError("terminal list failed")
        d = _deps(list_agents=boom, get_agent_states=lambda: [{"worktree": WT1, "pane": "p1", "state": "working", "agentType": "codex"}])
        status = control_service.get_status(d)
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["visual"], "EXECUTANDO")

    def test_legacy_success_with_zero_panes_is_ativo(self):
        d = _deps(list_agents=lambda: [], get_agent_states=lambda: [{"handle": "h1"}])
        status = control_service.get_status(d)
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "ATIVO")

    def test_valid_empty_structured_without_panes_is_ativo(self):
        for payload in ([], {"agents": []}, {"worktrees": []}):
            with self.subTest(payload=payload):
                d = _deps(get_agent_states=lambda p=payload: p)
                status = control_service.get_status(d)
                self.assertTrue(status["structuredOk"])
                self.assertEqual(status["visual"], "ATIVO")
                self.assertEqual(status["agents"], 0)

    def test_raw_worktree_ps_shape_with_all_known_states(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        payload = {"worktrees": [{"path": WT1, "agents": [{"paneKey": "pk1", "state": "waiting", "agentType": "codex"}]}]}
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: payload)
        status = control_service.get_status(d)
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["visual"], "ATIVO")
        self.assertEqual(status["agentStates"]["waiting"], 1)


class DuplicateAssociationTests(unittest.TestCase):
    def test_list_agents_injects_parent_path(self):
        agents = _discovered([{"path": WT1, "worktreeId": "w1"}], {WT1: [_raw_terminal("h1")]})
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["worktreePath"], WT1)
        self.assertEqual(agents[0]["worktreeId"], "w1")

    def test_list_agents_parent_path_is_authoritative(self):
        agents = _discovered([{"path": WT1, "worktreeId": "w1"}], {WT1: [_raw_terminal("h1", worktreePath="C:/custom", worktreeId="spoofed")]})
        self.assertEqual(agents[0]["worktreePath"], WT1)
        self.assertEqual(agents[0]["worktreeId"], "w1")

    def test_spoofed_paths_same_parent_still_grouped(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1", worktreePath=""), _raw_terminal("h2", worktreePath="C:/spoofed")]})
        self.assertTrue(all(a["worktreePath"] == WT1 for a in agents))
        states = [_structured_done(WT1, "p1"), _structured_done(WT1, "p2")]
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: states)
        status = control_service.get_status(d)
        self.assertEqual(len(status["duplicateAgents"]), 1)
        self.assertEqual(status["duplicateAgents"][0]["worktree"], WT1)

    def test_list_agents_filters_and_skips(self):
        worktrees = [{"path": WT1}, {"no-path": True}, 42, {"path": WT2}]
        terminals = {
            WT1: [_raw_terminal("h1"), _raw_terminal("h2", agent="claude"), _raw_terminal("h3", orphaned=True), 42, _raw_terminal("h4", connected=False)],
            WT2: RuntimeError("transient list failure"),
        }
        agents = _discovered(worktrees, terminals)
        self.assertEqual([a["handle"] for a in agents], ["h1", "h4"])
        self.assertTrue(all(a["worktreePath"] == WT1 for a in agents))

    def test_same_worktree_two_panes_flagged(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1"), _raw_terminal("h2")]})
        states = [_structured_done(WT1, "p1"), _structured_done(WT1, "p2")]
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: states)
        status = control_service.get_status(d)
        self.assertEqual(status["visual"], "ATIVO")
        self.assertEqual(len(status["duplicateAgents"]), 1)
        self.assertEqual(status["duplicateAgents"][0]["worktree"], WT1)
        self.assertIn("nenhum pane foi fechado automaticamente", status["warning"])
        self.assertIn("nenhum pane foi fechado automaticamente", status["message"])

    def test_distinct_worktrees_no_false_duplicate(self):
        worktrees = [{"path": WT1}, {"path": WT2}]
        terminals = {WT1: [_raw_terminal("h1")], WT2: [_raw_terminal("h2")]}
        agents = _discovered(worktrees, terminals)
        states = [_structured_done(WT1, "p1"), _structured_done(WT2, "p2")]
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: states)
        status = control_service.get_status(d)
        self.assertEqual(status["duplicateAgents"], [])
        self.assertEqual(status["warning"], "")
        self.assertEqual(status["visual"], "ATIVO")

    def test_pause_with_duplicates_never_closes_panes(self):
        seen = {}
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1"), _raw_terminal("h2")]})
        states = [_structured_done(WT1, "p1"), _structured_done(WT1, "p2")]
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: states, set_mode=lambda m: seen.update(mode=m) or m)
        msg = control_service.pause(d)
        self.assertEqual(seen["mode"], "PAUSED")
        self.assertNotIn("close", msg.lower())
        self.assertNotIn("kill", msg.lower())


class PauseFailClosedTests(unittest.TestCase):
    def test_pause_with_done_panes_uses_simple_message(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: [_structured_done(WT1, "p1")])
        self.assertEqual(control_service.pause(d), "Dispatcher pausado para novas tarefas.")

    def test_pause_with_working_agent_keeps_extended_message(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        d = _deps(list_agents=lambda: agents, get_agent_states=lambda: [{"worktree": WT1, "pane": "p1", "state": "working", "agentType": "codex"}])
        msg = control_service.pause(d)
        self.assertIn("execucao atual nao foi interrompida", msg.lower().replace("ç", "c").replace("ã", "a"))

    def test_pause_with_malformed_structured_keeps_extended_message(self):
        agents = _discovered([{"path": WT1}], {WT1: [_raw_terminal("h1")]})
        for payload in ([{"handle": "h1"}], [{"state": "bogus-state"}], "garbage", None):
            with self.subTest(payload=payload):
                d = _deps(list_agents=lambda: agents, get_agent_states=lambda p=payload: p)
                msg = control_service.pause(d)
                self.assertIn("execucao atual nao foi interrompida", msg.lower().replace("ç", "c").replace("ã", "a"))


    def test_pause_with_list_agents_failure_raises_without_persisting(self):
        seen = {}
        def boom():
            raise RuntimeError("terminal list failed")
        d = _deps(list_agents=boom, set_mode=lambda m: seen.update(mode=m) or m)
        with self.assertRaises(RuntimeError):
            control_service.pause(d)
        self.assertNotIn("mode", seen)


class ClassifyTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
