# HLAgent Gateway API

FastAPI 服务，端口 8000。通过 `uvicorn main:app --port 8000` 启动。

## 所有 API 端点

### 系统
| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `GET /api/onboarding/status` | 初始化状态（auth/project） |
| `POST /api/onboarding/init-project` | 初始化 CLAUDE.md 等 |

### 会话 & WebSocket
| 端点 | 说明 |
|------|------|
| `GET /api/sessions` | 列出历史会话 |
| `POST /api/sessions` | 创建新会话 `{session_id}` |
| `GET /api/sessions/{id}` | 获取 AppState（503 if not ready）|
| `DELETE /api/sessions/{id}` | 关闭会话 |
| `GET /api/sessions/{id}/commands` | 可用命令列表 |
| `GET /api/sessions/{id}/context` | 当前 system prompt |
| `GET /api/sessions/{id}/summary` | 对话摘要 |
| `GET /api/sessions/{id}/transcript` | 导出完整 transcript |
| `DELETE /api/sessions/{id}/messages/last` | 回退最后一轮（/rewind）|
| `POST /api/sessions/{id}/tag` | 命名快照 |
| `GET /api/sessions/{id}/permission-mode` | 权限模式 |
| `POST /api/sessions/{id}/permission-mode` | 切换权限模式 |
| `WS /ws/{session_id}` | WebSocket 双向通信 |

### 认证
| 端点 | 说明 |
|------|------|
| `GET /api/auth/status` | 所有 provider 认证状态 |
| `POST /api/auth/login` | 存储 API Key（仅存储不验证）|
| `DELETE /api/auth` | 清除凭据 |

### 设置
| 端点 | 说明 |
|------|------|
| `GET /api/settings` | 当前有效配置 |
| `PATCH /api/settings` | 更新配置字段 |
| `GET /api/settings/profiles` | Provider profiles 列表 |

### Cron 定时任务
| 端点 | 说明 |
|------|------|
| `GET /api/cron/jobs` | 列出所有 job |
| `POST /api/cron/jobs` | 创建/更新 job |
| `DELETE /api/cron/jobs/{name}` | 删除 job |
| `PATCH /api/cron/jobs/{name}/toggle` | 启用/禁用 `{enabled: bool}` |
| `GET /api/cron/jobs/{name}/history` | 执行历史 |
| `GET /api/cron/scheduler/status` | 调度器状态 |

### Swarm 团队
| 端点 | 说明 |
|------|------|
| `GET /api/swarm/teams` | 列出所有团队 |
| `GET /api/swarm/teams/{team}` | 完整 TeamFile |
| `POST /api/swarm/teams` | 创建团队 |
| `DELETE /api/swarm/teams/{team}` | 删除团队 |
| `GET /api/swarm/teams/{team}/members/{agent_id}` | 单成员详情 |
| `GET /api/swarm/teams/{team}/pending-permissions` | 待处理权限请求 |
| `POST /api/sessions/{id}/spawn` | 生成 teammate |
| `GET /api/swarm/agents/{id}/transcript` | Agent 对话记录 |
| `POST /api/swarm/agents/{id}/message` | 向 agent 发消息 |
| `POST /api/swarm/agents/{id}/permission-response` | 响应权限请求 |
| `DELETE /api/swarm/agents/{id}` | 关闭 agent |
| `GET /api/swarm/agents/{id}/messages` | 读取 mailbox |
| `PATCH /api/swarm/agents/{id}/messages/{msg_id}/read` | 标记已读 |

### Memory
| 端点 | 说明 |
|------|------|
| `GET /api/memory/files` | 列出 memory 文件 |
| `GET /api/memory/{filename}` | 读取文件内容 |
| `POST /api/memory` | 添加 memory 条目 |
| `DELETE /api/memory/{filename}` | 删除条目 |
| `POST /api/memory/dream` | 触发 autodream 整合 |

### Skills & Plugins & MCP
| 端点 | 说明 |
|------|------|
| `GET /api/skills` | 所有 skills |
| `GET /api/skills/{name}` | 读取 skill 内容 |
| `GET /api/plugins` | 已安装插件 |
| `GET /api/mcp/servers` | MCP server 状态 |

### 后台任务
| 端点 | 说明 |
|------|------|
| `GET /api/tasks` | 所有后台任务 |
| `GET /api/tasks/{id}` | 任务详情 + 输出 |
| `DELETE /api/tasks/{id}` | 停止任务 |

### Git & Autopilot & Debug
| 端点 | 说明 |
|------|------|
| `GET /api/git/diff` | git diff 输出 |
| `GET /api/git/branch` | 当前分支信息 |
| `GET /api/autopilot/tasks` | Autopilot 任务队列 |
| `POST /api/autopilot/ship` | 提交 repo 任务 |
| `GET /api/debug/doctor` | 环境诊断 |
| `GET /api/debug/hooks` | 已配置 hooks |

## WebSocket 协议

`WS /ws/{session_id}` 使用 JSON 消息格式：

**客户端 → 服务端 (FrontendRequest):**
```json
{"type": "submit_line", "line": "帮我写一个 hello world"}
{"type": "interrupt"}
{"type": "permission_response", "request_id": "...", "allowed": true}
{"type": "question_response", "request_id": "...", "answer": "yes"}
{"type": "select_command", "command": "model"}
{"type": "apply_select_command", "command": "model", "value": "claude-opus-4-7"}
{"type": "shutdown"}
```

**服务端 → 客户端 (BackendEvent):**
```json
{"type": "ready", "state": {...}, "tasks": [...], "commands": [...]}
{"type": "transcript_item", "item": {"role": "assistant", "text": "..."}}
{"type": "tool_started", "tool_name": "bash", "tool_input": {"command": "ls"}}
{"type": "assistant_delta", "message": "..."}
{"type": "line_complete"}
```
