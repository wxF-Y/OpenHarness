## Context

HLAgent Gateway 是多会话并发服务，每个会话通过 `BackendHostConfig.cwd` 独立持有工作目录。当前 Web UI 创建会话时一律传空对象，导致所有会话共用 Gateway 进程启动目录（`HLAGENT_CONFIG_DIR`）——Agent 的 CLAUDE.md 发现、文件操作、Bash 执行都基于此目录，无法区分项目。

关键约束：
- Gateway 是多租户进程，**不能 `os.chdir()`**（会影响全局）；cwd 必须作为参数贯穿
- `~/.hlagent/` 目录已由 `main.py` 通过 `OPENHARNESS_CONFIG_DIR` 独占，工作目录应放 `workspaces/` 子目录以隔离
- 前端只有一个部署域，无法访问用户任意文件系统路径（跨域/权限），目录浏览必须通过 Gateway API

## Goals / Non-Goals

**Goals:**
- 用户在创建 Session 时可选填工作目录（绝对路径）
- 未填写时 Gateway 自动分配 `~/.hlagent/workspaces/<session_id>/` 并创建该目录
- 删除 Session 时，若 cwd 为托管目录（在 `workspaces/` 下），自动递归删除，并在前端确认弹窗显示数据删除警告
- 前端 Session 创建入口展示目录输入框（含"浏览"功能调用 `/api/fs/ls`）
- Sidebar 会话列表显示每个 Session 的 cwd 路径（托管目录显示"临时"badge）

**Non-Goals:**
- 不支持在 Session 存活期间切换 cwd
- 不对用户指定的自定义 cwd 做清理（仅清理托管目录）
- 不实现 Session 级别的文件权限隔离

## Decisions

### 1. 托管目录路径方案：`~/.hlagent/workspaces/<session_id>/`

**选型**: `~/.hlagent/workspaces/<session_id>/`  
**备选**: 用短 UUID、用时间戳目录名  
**理由**: session_id 已是全局唯一标识符，目录与 Session 一一对应，清理时无需额外映射；`workspaces/` 前缀与 `data/`、`logs/` 等现有子目录风格一致，且可用路径前缀判断是否为托管目录。

### 2. "是否托管"判断方式：路径前缀检查

**选型**: 在 `delete_session` 中检查 `entry.cwd.is_relative_to(workspaces_root)`（`startswith()` 的类型安全替代，Python 3.9+，自动处理路径规范化）  
**备选**: 在 `SessionEntry` 中增加 `is_managed: bool` 字段  
**理由**: 路径前缀检查无状态，不需要持久化额外字段，且 Gateway 重启后仍然正确（托管目录是物理存在的）。SessionEntry 已是内存对象，重启即失，持久化标记无意义。

### 3. 前端目录浏览：新增 `/api/fs/ls` 端点

**选型**: 在 `fs.py` 中新增 `GET /api/fs/ls?path=<dir>` 路由  
**理由**: `fs.py` 已定义 `ListDirEntry` Pydantic model 但无对应路由；复用 model，新增路由即可；前端 DirBrowser 组件调用此接口实现目录导航。

### 4. 创建 Session 对话框：内联展开而非独立页面

**选型**: 在现有创建入口处弹出一个小对话框（Modal），包含路径输入框 + "浏览" + "创建"按钮  
**理由**: 场景简单，用完即走；独立页面增加路由复杂度，Onboarding 页面已是更重的引导流程，不应与之混淆。

## Risks / Trade-offs

- **递归删除风险** → 托管目录仅限 `~/.hlagent/workspaces/` 下，删除前二次校验路径前缀；不删除用户自定义 cwd
- **并发删除** → `delete_session` 先从 session_mgr 移除再删目录，避免 Agent 还在写文件时目录消失；若 Agent 仍在运行先调 `host.stop()` 等待结束
- **磁盘积累** → 长期运行会积累 `workspaces/` 下的孤立目录（Gateway 重启后无法自动清理内存会话）；当前接受此风险，后续可加 `/api/maintenance/cleanup-workspaces` 端点

## Migration Plan

纯新增功能，无数据迁移：
1. 部署新 Gateway 后，旧 `CreateSessionRequest`（无 `cwd`）行为从"用 Gateway cwd"变为"自动分配托管目录"——**行为变化但无破坏**，旧客户端仍可正常工作
2. 无回滚风险：托管目录按需创建，删除 Session 时清理，不影响其他数据

## Open Questions

- 目录浏览弹窗是否需要支持"新建目录"操作？（当前设计不含，如需要可后续单独迭代）
- `workspaces/` 目录是否需要设置容量上限或 TTL 清理策略？（当前不做，观察实际使用后决定）
