import json
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import os
_fixture = Path(tempfile.gettempdir()) / "mai69-linear-bus-config.toml"
if not _fixture.exists():
    _fixture.write_text(
        "orca_dir = \"C:/orca\"\n"
        "gh_executable = \"\"\n"
        "github_repo = \"example/repository\"\n"
        "repo_name = \"meuplantao\"\n"
        "repo_path = \"C:/repo\"\n"
        "worktree_root = \"C:/worktrees\"\n"
        "linear_workspace_id = \"workspace-id\"\n"
        "team = \"Team\"\n"
        "project = \"Proj\"\n",
        encoding="utf-8",
    )
os.environ["MEUPLANTAO_DISPATCHER_CONFIG"] = str(_fixture)

sys.path.insert(0, str(Path(__file__).parent))
import dispatcher

POLICY_ENTRY = {
    "id": "codex-luna", "agent": "codex", "model": "gpt-5.6-luna",
    "reasoning": "low", "command": "codex", "identity": "codex",
    "auth_mode": "chatgpt",
}
dispatcher.CONFIG.setdefault("allowed_workers", [dict(POLICY_ENTRY)])
dispatcher.CONFIG.setdefault("worker_id", "codex-luna")

ISSUE = {"id": "uuid-69", "identifier": "MAI-69", "title": "Linear bus"}
WORKTREE = {"id": "wt-69", "path": "C:/work/MAI-69", "displayName": "MAI-69-work", "linkedLinearIssue": "MAI-69"}


def _linear_issue(state_name="Todo", labels=(), team="Team", project=None):
    pname = project if project is not None else dispatcher.PROJECT
    return {"issue": {"team": {"name": team}, "project": {"name": pname},
                      "state": {"name": state_name},
                      "labels": [{"name": name} for name in labels]}}


def _read_outbox(path):
    target = Path(str(path))
    if not target.exists():
        return []
    entries = []
    for line in target.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            entries.append(json.loads(line))
    return entries


class LinearBusTests(unittest.TestCase):
    def test_claim_persists_dispatch_id_before_side_effect(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "create_workspace", return_value=(WORKTREE, "term-69")), \
             patch.object(dispatcher, "sync_started"), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.dispatch_issue(ISSUE, state, [], False))
        entry = state["issues"]["MAI-69"]
        self.assertIn("dispatchId", entry)
        self.assertTrue(entry["dispatchId"])
        self.assertEqual(entry["status"], "dispatched")

    def test_second_tick_does_not_duplicate_worktree_or_agent(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
             patch.object(dispatcher, "create_workspace", return_value=(WORKTREE, "term-69")), \
             patch.object(dispatcher, "sync_started"), \
             patch.object(dispatcher, "linear_comment"), \
             patch.object(dispatcher, "save_state"):
            self.assertTrue(dispatcher.dispatch_issue(ISSUE, state, [], False))
        with patch.object(dispatcher, "create_workspace") as create2, \
             patch.object(dispatcher, "recover_existing") as recover, \
             patch.object(dispatcher, "sync_started") as sync2, \
             patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [WORKTREE], False))
        create2.assert_not_called()
        recover.assert_not_called()
        sync2.assert_not_called()

    def test_ambiguous_create_failure_never_auto_retries(self):
        state = {"issues": {}}
        with tempfile.TemporaryDirectory() as tmp:
            outbox = str(Path(tmp) / "hermes-events.jsonl")
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
                 patch.object(dispatcher, "create_workspace", side_effect=RuntimeError("orca boom after create")), \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"):
                self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [], False))
            self.assertIn(state["issues"]["MAI-69"]["status"], ("dispatching", "dispatch-timeout"))
            self.assertIn("dispatchId", state["issues"]["MAI-69"])
            self.assertEqual(_read_outbox(outbox), [])
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "create_workspace") as create2, \
                 patch.object(dispatcher, "recover_existing") as recover, \
                 patch.object(dispatcher, "preflight_model", return_value=dict(POLICY_ENTRY)), \
                 patch.object(dispatcher, "save_state"):
                self.assertFalse(dispatcher.dispatch_issue(ISSUE, state, [], False))
            create2.assert_not_called()
            recover.assert_not_called()

    def test_linear_result_advances_without_terminal_consult(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1",
                                       "workspacePath": WORKTREE["path"]}}}
        with tempfile.TemporaryDirectory() as tmp:
            outbox = str(Path(tmp) / "hermes-events.jsonl")
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "orca", return_value=_linear_issue("In Progress", [])) as fake_orca, \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"):
                dispatcher.poll_linear_outcomes(state)
            terminal_calls = [c for c in fake_orca.call_args_list if len(c.args) >= 2 and c.args[0] == "terminal"]
            self.assertEqual(terminal_calls, [])

    def test_needs_review_notifies_hermes_exactly_once_per_fingerprint(self):
        state = {"issues": {}}
        pr = {"number": 41, "headRefOid": "sha-1", "url": "https://example.test/pr/41",
              "statusCheckRollup": []}
        with tempfile.TemporaryDirectory() as tmp:
            outbox = str(Path(tmp) / "hermes-events.jsonl")
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "orca"), \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"):
                dispatcher.mark_for_review("MAI-69", pr, state)
            self.assertEqual(len(_read_outbox(outbox)), 1)
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "orca") as retry_orca, \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"):
                dispatcher.mark_for_review("MAI-69", pr, state)
            retry_orca.assert_not_called()
            self.assertEqual(len(_read_outbox(outbox)), 1)

    def test_new_sha_resets_hermes_fingerprint(self):
        state = {"issues": {}}
        pr1 = {"number": 42, "headRefOid": "sha-old", "url": "https://example.test/pr/42",
               "statusCheckRollup": []}
        pr2 = {"number": 42, "headRefOid": "sha-new", "url": "https://example.test/pr/42",
               "statusCheckRollup": []}
        with tempfile.TemporaryDirectory() as tmp:
            outbox = str(Path(tmp) / "hermes-events.jsonl")
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "orca"), \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"):
                dispatcher.mark_for_review("MAI-69", pr1, state)
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "orca"), \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"):
                dispatcher.mark_for_review("MAI-69", pr2, state)
            entries = _read_outbox(outbox)
            self.assertEqual(len(entries), 2)
            self.assertNotEqual(entries[0]["fingerprint"], entries[1]["fingerprint"])
            self.assertEqual(state["issues"]["MAI-69"]["reviewMarker"], "42:sha-new")

    def test_blocked_notifies_hermes_exactly_once(self):
        state = {"issues": {"MAI-69": {"status": "dispatched", "dispatchId": "d-1"}}}
        with tempfile.TemporaryDirectory() as tmp:
            outbox = str(Path(tmp) / "hermes-events.jsonl")
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "orca", return_value=_linear_issue("Blocked", [])), \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"):
                dispatcher.poll_linear_outcomes(state)
                dispatcher.poll_linear_outcomes(state)
            self.assertEqual(len(_read_outbox(outbox)), 1)

    def test_dispatch_timeout_marks_and_notifies_once_without_redispatch(self):
        state = {"issues": {"MAI-69": {"status": "dispatching", "dispatchId": "d-1",
                                       "claimedAt": 1000}}}
        with tempfile.TemporaryDirectory() as tmp:
            outbox = str(Path(tmp) / "hermes-events.jsonl")
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "orca", return_value=_linear_issue("Todo", ["Orca Ready"])), \
                 patch.object(dispatcher, "linear_comment"), \
                 patch.object(dispatcher, "save_state"), \
                 patch.object(dispatcher, "create_workspace") as create, \
                 patch.object(dispatcher, "DISPATCH_TIMEOUT_SECONDS", 60):
                dispatcher.poll_linear_outcomes(state, now=2000)
                dispatcher.poll_linear_outcomes(state, now=2000)
            self.assertEqual(state["issues"]["MAI-69"]["status"], "dispatch-timeout")
            self.assertEqual(len(_read_outbox(outbox)), 1)
            create.assert_not_called()

    def test_hermes_event_contains_only_issue_and_type(self):
        state = {"issues": {}}
        with tempfile.TemporaryDirectory() as tmp:
            outbox = str(Path(tmp) / "hermes-events.jsonl")
            with patch.object(dispatcher, "HERMES_EVENTS_PATH", outbox), \
                 patch.object(dispatcher, "save_state"):
                dispatcher.emit_hermes_event("MAI-69", "needs-review", "MAI-69:needs-review:x", state)
            entries = _read_outbox(outbox)
            self.assertEqual(len(entries), 1)
            entry = entries[0]
            self.assertEqual(set(entry.keys()), {"issue", "event", "fingerprint", "at", "prompt"})
            self.assertEqual(entry["issue"], "MAI-69")
            self.assertEqual(entry["event"], "needs-review")
            prompt = entry["prompt"]
            self.assertIn("MAI-69", prompt)
            self.assertIn("needs-review", prompt)
            self.assertNotIn("https://", prompt)
            self.assertNotIn("sha", prompt.lower())
            self.assertNotIn("token", prompt.lower())

    def test_no_llm_call_in_polling_and_coordination(self):
        source = Path(dispatcher.__file__).read_text(encoding="utf-8").lower()
        for token in ("openai", "anthropic", "chat.completions", "responses.create",
                      "llm_client", "sk-ant-"):
            self.assertNotIn(token, source)
        self.assertIn("def poll_linear_outcomes", source)
        self.assertIn("def emit_hermes_event", source)

    def test_missing_policy_means_zero_creation_and_sanitized_error(self):
        state = {"issues": {}}
        with patch.object(dispatcher, "allowed_workers", side_effect=RuntimeError("preflight: worker policy missing")), \
             patch.object(dispatcher, "create_workspace") as create, \
             patch.object(dispatcher, "sync_started") as sync, \
             patch.object(dispatcher, "linear_comment") as comment, \
             patch.object(dispatcher, "save_state"):
            self.assertFalse(dispatcher.dispatch_issue(
                {"identifier": "MAI-69", "title": "t"}, state, [], False))
        create.assert_not_called()
        sync.assert_not_called()
        self.assertEqual(state["issues"]["MAI-69"]["status"], "error")
        if comment.called:
            body = comment.call_args.args[1]
            self.assertNotIn("chatgpt", body.lower())
            self.assertNotIn("token", body.lower())


if __name__ == "__main__":
    unittest.main()
