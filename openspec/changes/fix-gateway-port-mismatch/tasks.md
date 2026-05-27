## 1. 修复 HLAgent/restart.sh 补充 stop subcommand

- [x] 1.1 在 `HLAgent/restart.sh` 的 case 语句中添加 `stop` subcommand，停止端口 7779 和 5173

## 2. 覆写 scripts/ 下的脚本

- [x] 2.1 用委托脚本覆写 `scripts/start.sh`（调用 restart.sh all）
- [x] 2.2 用委托脚本覆写 `scripts/stop.sh`（调用 restart.sh stop）
- [x] 2.3 新建 `scripts/restart.sh`（透传参数给 HLAgent/restart.sh）
