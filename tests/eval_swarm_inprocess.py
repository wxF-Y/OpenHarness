"""Harness eval: validate swarm in_process member — mailbox, session_id, transcript."""
import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent / "HLAgent" / "gateway"))


TEST_TEAM = f"eval-{int(time.time()) % 99999}"
MEMBER_NAME = "test-worker"


async def run():
    from openharness.config.paths import get_config_dir
    from openharness.swarm.team_lifecycle import TeamLifecycleManager, TeamMember, TeamFile
    from openharness.tools.swarm_create_run_tool import SwarmCreateRunTool, SwarmCreateRunInput
    from openharness.tools.swarm_spawn_member_tool import SwarmSpawnMemberTool, SwarmSpawnMemberInput
    from openharness.tools.swarm_wait_tool import SwarmWaitTool, SwarmWaitInput
    from openharness.tools.base import ToolExecutionContext

    config_dir = get_config_dir()
    ctx = ToolExecutionContext(cwd=Path(os.getcwd()))

    results = {}

    print(f"\n{'='*60}")
    print(f"TEST TEAM: {TEST_TEAM}")

    # ── 1. Create team + member ───────────────────────────────────────────────
    mgr = TeamLifecycleManager()
    mgr.create_team(TEST_TEAM, "eval team")
    member = TeamMember(
        agent_id=f"{MEMBER_NAME}@{TEST_TEAM}",
        name=MEMBER_NAME,
        backend_type="in_process",
        joined_at=time.time(),
        prompt="You are a concise assistant. When given any task, reply with one sentence starting with DONE: describing what was asked.",
    )
    mgr.add_member(TEST_TEAM, member)
    print(f"Created team '{TEST_TEAM}' with in_process member '{MEMBER_NAME}'")

    # ── 2. swarm_create_run ───────────────────────────────────────────────────
    cr = await SwarmCreateRunTool().execute(SwarmCreateRunInput(team=TEST_TEAM, goal="eval-run"), ctx)
    run_id = cr.metadata.get("run_id", "")
    run_slug = cr.metadata.get("goal_slug", "")
    print(f"run_id = {run_id}")
    assert run_id, f"No run_id! output: {cr.output}"

    # ── 3. swarm_spawn_member ─────────────────────────────────────────────────
    sr = await SwarmSpawnMemberTool().execute(
        SwarmSpawnMemberInput(team=TEST_TEAM, member=MEMBER_NAME,
                              task="Say hello to the eval test.", run_id=run_id),
        ctx
    )
    print(f"spawn output: {sr.output}")
    if sr.is_error:
        print(f"SPAWN ERROR: {sr.output}")
        results["spawn"] = "ERROR"
    else:
        results["spawn"] = "OK"

    # ── 4. swarm_wait ─────────────────────────────────────────────────────────
    print("Waiting (60s)...")
    wr = await SwarmWaitTool().execute(
        SwarmWaitInput(team=TEST_TEAM, run_id=run_id, timeout=60), ctx
    )
    wait_data = json.loads(wr.output)
    print(f"all_done={wait_data['all_done']}, completed={list(wait_data['completed'].keys())}")

    # ── CHECK 1: Mailbox location ─────────────────────────────────────────────
    expected = config_dir / "teams-tasks" / TEST_TEAM / run_slug / "agents" / "leader" / "inbox"
    wrong    = config_dir / "teams" / TEST_TEAM / "agents" / "leader" / "inbox"
    mailbox_ok    = expected.exists()
    mailbox_wrong = wrong.exists()

    print(f"\n--- CHECK 1: Mailbox location ---")
    print(f"  tasks dir  ({'+' if mailbox_ok else '-'}): {expected}")
    print(f"  template   ({'+' if mailbox_wrong else '-'}): {wrong}")

    if mailbox_ok and not mailbox_wrong:
        results["mailbox"] = "PASS"
        print("  PASS: mailbox in task directory only")
    elif mailbox_ok and mailbox_wrong:
        results["mailbox"] = "PARTIAL"
        print("  PARTIAL: in task dir AND template dir")
    else:
        results["mailbox"] = "FAIL"
        print("  FAIL: mailbox not in task directory")

    # ── CHECK 2: session_id in run team.json ──────────────────────────────────
    print(f"\n--- CHECK 2: session_id in run team.json ---")
    run_tj = config_dir / "teams-tasks" / TEST_TEAM / run_slug / "team.json"
    session_id = None
    cwd_val = None
    if run_tj.exists():
        rd = json.loads(run_tj.read_text(encoding="utf-8"))
        for aid, m in rd.get("members", {}).items():
            session_id = m.get("session_id")
            cwd_val = m.get("cwd") or os.getcwd()
            print(f"  {aid}: session_id={session_id}, cwd={cwd_val}")
    if session_id:
        results["session_id"] = "PASS"
        print("  PASS: session_id present")
    else:
        results["session_id"] = "FAIL"
        print("  FAIL: no session_id")

    # ── CHECK 3: transcript loadable ──────────────────────────────────────────
    print(f"\n--- CHECK 3: Transcript ---")
    if session_id and cwd_val:
        from openharness.services.session_backend import DEFAULT_SESSION_BACKEND
        snap = DEFAULT_SESSION_BACKEND.load_by_id(cwd_val, session_id)
        if snap:
            msgs = snap.get("messages", [])
            print(f"  Session messages: {len(msgs)}")
            for m in msgs:
                role = m.get("role", "")
                c = m.get("content", "")
                text = (
                    " ".join(b.get("text","") for b in c if isinstance(b,dict) and b.get("type")=="text")
                    if isinstance(c, list) else str(c)
                )
                print(f"  [{role[:5]}] {text[:120]}")
            if len(msgs) >= 1:
                results["transcript"] = "PASS"
                print("  PASS: transcript loaded")
            else:
                results["transcript"] = "FAIL"
                print("  FAIL: session empty")
        else:
            results["transcript"] = "FAIL"
            print(f"  FAIL: could not load session {session_id} from cwd={cwd_val}")
            # List session dir
            from openharness.services.session_storage import get_project_session_dir
            sess_dir = get_project_session_dir(cwd_val)
            print(f"  Session dir: {sess_dir}")
            if sess_dir.exists():
                files = list(sess_dir.iterdir())
                print(f"  Files: {[f.name for f in files]}")
    else:
        results["transcript"] = "SKIP"

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("RESULTS:")
    for k, v in results.items():
        icon = "✅" if v == "PASS" else ("⚠️" if v == "PARTIAL" else "❌")
        print(f"  {icon} {k}: {v}")
    return results


if __name__ == "__main__":
    try:
        asyncio.run(run())
    finally:
        # Cleanup
        try:
            from openharness.config.paths import get_config_dir
            from openharness.swarm.mailbox import get_team_dir
            shutil.rmtree(get_team_dir(TEST_TEAM), ignore_errors=True)
            shutil.rmtree(get_config_dir() / "teams-tasks" / TEST_TEAM, ignore_errors=True)
            print(f"\nCleaned up {TEST_TEAM}")
        except Exception:
            pass
