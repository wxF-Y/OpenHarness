## Why

创建 Swarm 团队时，"选专家"步骤报错 `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`。

**根因：** `scripts/start.sh` 用端口 `8000` 启动网关，但 `HLAgent/web/.env` 设置 `VITE_GATEWAY_PORT=7779`，导致 Vite 代理（`/api → http://localhost:7779`）打到错误端口，网关不在该端口监听，Vite fallback 返回 `index.html`（HTML），前端解析 JSON 失败。

`HLAgent/restart.sh` 正确使用端口 `7779`。

**修复目标：** 用 `HLAgent/restart.sh` 的正确端口逻辑覆写 `scripts/` 下的启动/停止脚本，统一入口。

## What Changes

- `scripts/start.sh` → 委托给 `HLAgent/restart.sh all`
- `scripts/stop.sh` → 停止端口 7779 和 5173
- `scripts/restart.sh` → 新建，委托给 `HLAgent/restart.sh`

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
（无 spec 变更）

## Impact

- `scripts/start.sh`、`scripts/stop.sh`（修改）
- `scripts/restart.sh`（新建）
