# Verification Report: fix-gateway-port-mismatch

**Date:** 2026-05-27
**Change:** fix-gateway-port-mismatch
**Mode:** light (hotfix, 3 tasks, 4 files)
**Result:** PASS

## 根因

`scripts/start.sh` 启动 gateway:8000，但 `HLAgent/web/.env` 配置 `VITE_GATEWAY_PORT=7779`，Vite 代理到错误端口，返回 HTML 而非 JSON。

## 修复

- `HLAgent/restart.sh`: 新增 `stop` subcommand
- `scripts/start.sh` / `scripts/stop.sh`: 委托给 `HLAgent/restart.sh`
- `scripts/restart.sh`: 新建，透传参数

## 验证清单

| # | Check | Result |
|---|-------|--------|
| 1 | tasks.md 全部完成 | ✅ PASS |
| 2 | 改动文件与 tasks 一致（HLAgent/restart.sh + scripts/×3） | ✅ PASS |
| 3 | 角色库 API 返回 JSON（通过 Vite 代理） | ✅ PASS |
| 4 | 无安全问题 | ✅ PASS |
| 5 | 根因消除：scripts/start.sh 重启后角色库正常 | ✅ PASS |
