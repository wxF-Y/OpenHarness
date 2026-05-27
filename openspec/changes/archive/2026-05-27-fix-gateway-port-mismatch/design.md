## Context

两个启动脚本并存，端口不一致：
- `scripts/start.sh` → gateway:8000
- `HLAgent/restart.sh` → gateway:7779（与 .env 一致）

## Fix

将 `scripts/` 下的脚本改为委托调用 `HLAgent/restart.sh`，所有端口逻辑集中在一处。

## Implementation

`scripts/start.sh` — 封装 restart.sh all：
```bash
#!/usr/bin/env bash
exec bash "$(dirname "${BASH_SOURCE[0]}")/../HLAgent/restart.sh" all
```

`scripts/stop.sh` — 停止两个服务端口：
```bash
#!/usr/bin/env bash
exec bash "$(dirname "${BASH_SOURCE[0]}")/../HLAgent/restart.sh" stop
```

`scripts/restart.sh` — 透传参数：
```bash
#!/usr/bin/env bash
exec bash "$(dirname "${BASH_SOURCE[0]}")/../HLAgent/restart.sh" "${@:-all}"
```

注：`HLAgent/restart.sh` 暂无 `stop` subcommand，需补充。
