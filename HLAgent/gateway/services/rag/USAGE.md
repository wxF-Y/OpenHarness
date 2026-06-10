# 用户文档

## .ragignore

`.ragignore` 文件位于 cwd 根目录，使用 gitignore 语法。优先于 `.gitignore` 应用 (后者先过滤、`.ragignore` 可白名单覆盖)。

示例:

```
node_modules/
dist/
secrets.txt
!docs/api.md   # whitelist override
```

## 预算

默认日额度 $1。超额行为可选 `pause` (watcher 暂停) / `warn` (仅记录) / `hard_stop` (中止当前任务)。

## 切换 Provider 注意

新 provider 维度与现有索引不一致时，会强制全量重建 (UI 弹确认)。

## Watcher

默认开启。500ms 防抖 + 3s 聚合 flush + 8 并发嵌入 + 5min 健康检查 + 3 次连续失败暂停。
