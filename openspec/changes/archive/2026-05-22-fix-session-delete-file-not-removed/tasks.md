## 1. session_storage 新增删除函数

- [x] 1.1 在 `src/openharness/services/session_storage.py` 中新增 `delete_session_snapshot(cwd, session_id)` 函数
- [x] 1.2 实现逻辑：`cwd` 为 None 时直接返回；定位 `session-<session_id>.json` 并删除（文件不存在时静默跳过）
- [x] 1.3 实现 `latest.json` 同步清理：读取 `latest.json`，若其 `session_id` 字段与参数匹配则删除

## 2. Gateway delete_session handler 调用删除函数

- [x] 2.1 在 `HLAgent/gateway/routers/sessions.py` 的 `delete_session` 中，在 `await entry.host.stop()` 之前获取 internal session_id：`internal_sid = entry.host.get_session_id()`
- [x] 2.2 在 `session_mgr.remove(session_id)` 之后，调用 `delete_session_snapshot(cwd_str, internal_sid)`（internal_sid 为 None 时跳过）
- [x] 2.3 在 `sessions.py` 顶部添加 `from openharness.services.session_storage import delete_session_snapshot` 导入

## 3. 验证

- [x] 3.1 手动测试：创建 session → 发送一条消息（触发快照保存）→ 删除 session → 确认 `~/.openharness/data/sessions/` 下文件已删除
- [x] 3.2 确认删除不带 CWD 的 session 不报错
- [x] 3.3 确认删除未就绪的 session（host 未完成初始化）不报错
