"""E2E self-test for R1 + CR fixes: mailbox isolation, session save order, config/runtime separation."""
import asyncio, json, os, shutil, sys, time
from pathlib import Path
sys.path.insert(0, str(Path('E:/AI/OpenHarness/src')))

TEST_TEAM = f"eval-r1-{int(time.time())%9999}"
MEMBER = "test-member"

async def run():
    from openharness.config.paths import get_config_dir
    from openharness.swarm.team_lifecycle import TeamLifecycleManager, TeamMember
    from openharness.tools.swarm_create_run_tool import SwarmCreateRunTool, SwarmCreateRunInput
    from openharness.tools.swarm_spawn_member_tool import SwarmSpawnMemberTool, SwarmSpawnMemberInput
    from openharness.tools.swarm_wait_tool import SwarmWaitTool, SwarmWaitInput
    from openharness.tools.base import ToolExecutionContext

    config_dir = get_config_dir()
    ctx = ToolExecutionContext(cwd=Path(os.getcwd()))
    results = {}

    # Setup
    mgr = TeamLifecycleManager()
    mgr.create_team(TEST_TEAM, "R1 eval team")
    mgr.add_member(TEST_TEAM, TeamMember(
        agent_id=f"{MEMBER}@{TEST_TEAM}", name=MEMBER,
        backend_type="in_process", joined_at=time.time(),
        prompt="You are a test worker. Reply with DONE.",
    ))

    # Create run with Chinese goal name (CR-GW-3 test)
    cr = await SwarmCreateRunTool().execute(SwarmCreateRunInput(team=TEST_TEAM, goal="测试任务验证"), ctx)
    run_id = cr.metadata["run_id"]
    run_slug = cr.metadata["goal_slug"]
    print(f"run_id = {run_id}")
    print(f"run_slug = {run_slug}")

    # Spawn member
    sr = await SwarmSpawnMemberTool().execute(
        SwarmSpawnMemberInput(team=TEST_TEAM, member=MEMBER, task="Say hello for the eval test.", run_id=run_id),
        ctx
    )
    print(f"spawn: {sr.output}")
    results["spawn"] = "ERROR" if sr.is_error else "OK"

    # Wait
    wr = await SwarmWaitTool().execute(SwarmWaitInput(team=TEST_TEAM, run_id=run_id, timeout=60), ctx)
    wd = json.loads(wr.output)
    results["all_done"] = "OK" if wd["all_done"] else "FAIL"

    # CHECK 1: Template team.json has no session_id (CR config/runtime separation)
    tpl = json.loads((config_dir / "teams" / TEST_TEAM / "team.json").read_text(encoding="utf-8"))
    tpl_sids = [m.get("session_id") for m in tpl.get("members", {}).values()]
    results["template_clean"] = "PASS" if all(s is None for s in tpl_sids) else f"FAIL: {tpl_sids}"

    # CHECK 2: Mailbox ONLY in teams-tasks (no template dir mailbox)
    tasks_inbox = config_dir / "teams-tasks" / TEST_TEAM / run_slug / "agents" / "leader" / "inbox"
    tpl_inbox = config_dir / "teams" / TEST_TEAM / "agents"
    results["mailbox_tasks"] = "PASS" if tasks_inbox.exists() else "FAIL"
    results["mailbox_template_clean"] = "PASS" if not tpl_inbox.exists() else "FAIL"

    # CHECK 3: session_id in run team.json, session file exists
    run_tj = json.loads((config_dir / "teams-tasks" / TEST_TEAM / run_slug / "team.json").read_text(encoding="utf-8"))
    sid = next((m.get("session_id") for m in run_tj.get("members", {}).values()), None)
    cwd_val = next((m.get("cwd") for m in run_tj.get("members", {}).values()), None)
    results["run_session_id"] = "PASS" if sid else "FAIL"

    if sid and cwd_val:
        from openharness.services.session_backend import DEFAULT_SESSION_BACKEND
        snap = DEFAULT_SESSION_BACKEND.load_by_id(cwd_val, sid)
        results["session_loadable"] = "PASS" if snap and snap.get("messages") else "FAIL"
        if snap:
            msgs = snap.get("messages", [])
            print(f"  session messages: {len(msgs)}")
            for m in msgs[:2]:
                role = m.get("role","")
                c = m.get("content","")
                text = c if isinstance(c,str) else " ".join(b.get("text","") for b in c if isinstance(b,dict) and b.get("type")=="text")
                print(f"  [{role}]: {text[:80]}")
    else:
        results["session_loadable"] = "SKIP"

    # CHECK 4: Chinese run_slug accessible via gateway validation
    from HLAgent.gateway.routers.swarm import _SAFE_RUN_SLUG_RE
    results["chinese_slug_valid"] = "PASS" if _SAFE_RUN_SLUG_RE.match(run_slug) else "FAIL"

    print("\n=== RESULTS ===")
    all_pass = True
    for k, v in results.items():
        icon = "PASS" if v in ("PASS", "OK") else "FAIL"
        print(f"  {icon}: {k} = {v}")
        if icon == "FAIL": all_pass = False
    return all_pass

try:
    ok = asyncio.run(run())
finally:
    try:
        from openharness.config.paths import get_config_dir
        from openharness.swarm.mailbox import get_team_dir
        shutil.rmtree(get_team_dir(TEST_TEAM), ignore_errors=True)
        shutil.rmtree(get_config_dir() / "teams-tasks" / TEST_TEAM, ignore_errors=True)
        print(f"Cleaned up {TEST_TEAM}")
    except: pass
