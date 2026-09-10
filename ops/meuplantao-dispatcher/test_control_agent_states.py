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


def _envelope(items_key, items):
    return {items_key: items, "hostScope": {"hostIds": ["host-1"], "omittedHostIds": []}, "totalCount": len(items), "truncated": False}


def _orca_side_effect(worktrees, terminals_by_path):
    def fake(*args, **kwargs):
        if tuple(args[:2]) == ("worktree", "list"):
            return _envelope("worktrees", worktrees)
        if tuple(args[:2]) == ("terminal", "list"):
            selector = next((a for a in args if isinstance(a, str) and a.startswith("path:")), "")
            result = terminals_by_path.get(selector[len("path:"):], [])
            if isinstance(result, Exception):
                raise result
            return _envelope("terminals", result)
        raise AssertionError(f"unexpected orca call: {args}")
    return fake


def _ps_agent(pane, state):
    return {"paneKey": pane, "state": state, "agentType": "codex"}


def _ps_worktree(repo, agents, path=None):
    return {"repo": repo, "repoId": "repo-" + repo, "path": path or WT1, "agents": agents}


def _ps_result(worktrees, **over):
    payload = {"worktrees": worktrees, "hostScope": {"hostIds": ["host-1"], "omittedHostIds": []}, "totalCount": len(worktrees), "truncated": False}
    payload.update(over)
    return payload


def _real_status(ps_result, wl_worktrees, terminals_by_path):
    import dispatcher_home
    def fake_orca(*args, **kwargs):
        if tuple(args[:2]) == ("worktree", "list"):
            if isinstance(wl_worktrees, dict):
                return wl_worktrees
            return _envelope("worktrees", wl_worktrees)
        if tuple(args[:2]) == ("terminal", "list"):
            selector = next((a for a in args if isinstance(a, str) and a.startswith("path:")), "")
            result = terminals_by_path.get(selector[len("path:"):], [])
            if isinstance(result, Exception):
                raise result
            if isinstance(result, dict):
                return result
            return _envelope("terminals", result)
        if tuple(args[:2]) == ("worktree", "ps"):
            if isinstance(ps_result, Exception):
                raise ps_result
            return ps_result
        raise AssertionError(f"unexpected orca call: {args}")
    with mock.patch.object(control_service, "_orca_run", side_effect=fake_orca):
        with mock.patch.object(dispatcher_home, "load_config_dict", return_value={"repo_name": "meuplantao"}):
            d = _deps()
            del d["list_agents"]
            del d["get_agent_states"]
            return control_service.get_status(d)


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
                {"paneKey": "p3", "state": "blocked", "agentType": "codex"},
                {"paneKey": "p4", "state": "done", "agentType": "codex"},
                {"paneKey": "p5", "state": "done", "agentType": "codex"},
            ]},
        ]}
        result = control_service._coerce_structured_states(payload)
        self.assertEqual(len(result), 5)
        self.assertEqual(result[0]["worktree"], WT1)
        self.assertEqual(result[0]["pane"], "p1")
        summary = control_service.summarize_agent_states(result)
        self.assertEqual((summary["active"], summary["waiting"], summary["idle"], summary["failed"]), (1, 2, 2, 0))

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

    def test_real_route_terminal_failure_without_structured_is_error(self):
        import dispatcher_home
        for ps_payload in (None, {"unexpected": True}):
            with self.subTest(ps_payload=ps_payload):
                def fake_orca(*args, _ps=ps_payload, **kwargs):
                    if tuple(args[:2]) == ("worktree", "list"):
                        return {"worktrees": [{"path": WT1, "worktreeId": "w1"}]}
                    if tuple(args[:2]) == ("terminal", "list"):
                        raise RuntimeError("terminal list failed")
                    if tuple(args[:2]) == ("worktree", "ps"):
                        return _ps
                    raise AssertionError(f"unexpected orca call: {args}")
                with mock.patch.object(control_service, "_orca_run", side_effect=fake_orca):
                    with mock.patch.object(dispatcher_home, "load_config_dict", return_value={"repo_name": "meuplantao"}):
                        d = _deps()
                        del d["list_agents"]
                        del d["get_agent_states"]
                        status = control_service.get_status(d)
                self.assertFalse(status["structuredOk"])
                self.assertEqual(status["visual"], "ERRO")
                self.assertEqual(status["agents"], 0)
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

    def test_list_agents_terminal_failure_propagates(self):
        worktrees = [{"path": WT1}, {"path": WT2}]
        terminals = {WT1: [_raw_terminal("h1")], WT2: RuntimeError("transient list failure")}
        with self.assertRaises(RuntimeError):
            _discovered(worktrees, terminals)

    def test_list_agents_terminal_invalid_shape_propagates(self):
        worktrees = [{"path": WT1}]
        terminals = {WT1: {"terminals": "not-a-list"}}
        with self.assertRaises(RuntimeError):
            _discovered(worktrees, terminals)

    def test_list_agents_filters_and_skips(self):
        worktrees = [{"path": WT1}, {"no-path": True}, 42]
        terminals = {
            WT1: [_raw_terminal("h1"), _raw_terminal("h2", agent="claude"), _raw_terminal("h3", orphaned=True), 42, _raw_terminal("h4", connected=False)],
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


    def test_pause_with_incomplete_structured_raises_without_persisting(self):
        seen = {}
        d = _deps(get_agent_states=lambda: control_service.STRUCTURED_INCOMPLETE, set_mode=lambda m: seen.update(mode=m) or m)
        with self.assertRaises(RuntimeError):
            control_service.pause(d)
        self.assertNotIn("mode", seen)

    def test_pause_with_list_agents_failure_raises_without_persisting(self):
        seen = {}
        def boom():
            raise RuntimeError("terminal list failed")
        d = _deps(list_agents=boom, set_mode=lambda m: seen.update(mode=m) or m)
        with self.assertRaises(RuntimeError):
            control_service.pause(d)
        self.assertNotIn("mode", seen)


class EnvelopeAndRepoScopeTests(unittest.TestCase):
    def test_blocked_is_waiting_never_executing(self):
        status = _real_status(_ps_result([_ps_worktree("meuplantao", [_ps_agent("p1", "blocked")])]), [{"path": WT1}], {WT1: []})
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["visual"], "ATIVO")
        self.assertEqual(status["agents"], 0)
        self.assertEqual(status["agentStates"]["waiting"], 1)

    def test_idle_failed_rejected_as_unknown(self):
        for state in ("idle", "failed"):
            with self.subTest(state=state):
                self.assertIsNone(control_service._coerce_structured_states([{"worktree": WT1, "pane": "p1", "state": state, "agentType": "codex"}]))
                self.assertEqual(control_service.classify_agent_state(state), "DESCONHECIDO")

    def test_truncated_ps_is_error_never_ativo(self):
        payload = _ps_result([_ps_worktree("meuplantao", [_ps_agent("p1", "done")])], truncated=True)
        status = _real_status(payload, [{"path": WT1}], {WT1: []})
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "ERRO")
        self.assertIn("fail-closed", status.get("error", ""))

    def test_ps_without_verifiable_host_scope_is_error(self):
        base = [_ps_worktree("meuplantao", [_ps_agent("p1", "done")])]
        bad = [
            {"worktrees": base, "totalCount": 1, "truncated": False},
            _ps_result(base, hostScope=None),
            _ps_result(base, hostScope={"hostIds": [], "omittedHostIds": []}),
            _ps_result(base, hostScope={"hostIds": ["host-1"], "omittedHostIds": ["host-9"]}),
            _ps_result(base, totalCount=7),
            _ps_result(base, totalCount="1"),
        ]
        for payload in bad:
            with self.subTest(payload=payload):
                status = _real_status(payload, [{"path": WT1}], {WT1: []})
                self.assertFalse(status["structuredOk"])
                self.assertEqual(status["visual"], "ERRO")
                self.assertIn("fail-closed", status.get("error", ""))

    def test_truncated_terminal_list_is_error(self):
        ps = _ps_result([_ps_worktree("meuplantao", [_ps_agent("p1", "paused")])])
        raw = {"terminals": [], "hostScope": {"hostIds": ["host-1"], "omittedHostIds": []}, "totalCount": 0, "truncated": True}
        status = _real_status(ps, [{"path": WT1}], {WT1: raw})
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "ERRO")
        self.assertIn("descoberta legada", status.get("error", ""))

    def test_incoherent_terminal_total_count_is_error(self):
        ps = _ps_result([_ps_worktree("meuplantao", [_ps_agent("p1", "paused")])])
        tl = _envelope("terminals", [])
        tl["totalCount"] = 4
        status = _real_status(ps, [{"path": WT1}], {WT1: tl})
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "ERRO")
        self.assertIn("descoberta legada", status.get("error", ""))

    def test_truncated_worktree_list_is_error(self):
        ps = _ps_result([_ps_worktree("meuplantao", [_ps_agent("p1", "paused")])])
        wl = _envelope("worktrees", [{"path": WT1}])
        wl["truncated"] = True
        status = _real_status(ps, wl, {WT1: []})
        self.assertFalse(status["structuredOk"])
        self.assertEqual(status["visual"], "ERRO")
        self.assertIn("descoberta legada", status.get("error", ""))

    def test_other_repo_working_does_not_execute(self):
        ps = _ps_result([_ps_worktree("meuplantao", [_ps_agent("p1", "done")]), _ps_worktree("outro-repo", [_ps_agent("p9", "working")], path=WT2)])
        status = _real_status(ps, [{"path": WT1}], {WT1: []})
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["visual"], "ATIVO")
        self.assertEqual(status["agents"], 0)

    def test_own_repo_working_executes(self):
        ps = _ps_result([_ps_worktree("meuplantao", [_ps_agent("p1", "working")]), _ps_worktree("outro-repo", [_ps_agent("p9", "done")], path=WT2)])
        status = _real_status(ps, [{"path": WT1}], {WT1: []})
        self.assertTrue(status["structuredOk"])
        self.assertEqual(status["visual"], "EXECUTANDO")
        self.assertEqual(status["agents"], 1)


class ClassifyTests(unittest.TestCase):
    def test_classify_mapping(self):
        cases = {
            "working": "EXECUTANDO",
            " Working ": "EXECUTANDO",
            "waiting": "AGUARDANDO",
            "blocked": "AGUARDANDO",
            "done": "OCIOSO",
            "idle": "DESCONHECIDO",
            "failed": "DESCONHECIDO",
            None: "DESCONHECIDO",
            "": "DESCONHECIDO",
            "bogus-state": "DESCONHECIDO",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(control_service.classify_agent_state(raw), expected)


if __name__ == "__main__":
    unittest.main()
