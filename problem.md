# Nexus Terminal 当前问题清单

> 本文件只保留**尚未闭环、可执行、可验证**的问题。已完成、已排除的问题不保留墓碑；历史完成记录以 Git 历史与对应提交为准。
> 问题闭环并验证后，直接从本文件删除，不保留“已完成”条目。
> 新增规则：项目所有者明确要求在仓库根目录维护本文件。

## 当前开放问题

### P-001 持续输出 PTY 的挂起会话无法恢复（owner lease 被撤销）

- **状态**：代码已修复（本地提交 `31fe03b8`），线上 `dev` 镜像尚未部署。
- **发现日期**：2026-09-30。
- **现象**：前端列出可恢复的挂起会话（`status: active`、`ownershipState: available`），点击恢复后一致失败、无法进入会话。
- **环境**：`root@honus.top:9902`，`/home/honus/product/nexus_terminal`，镜像 `ghcr.io/0honus0/nexus-terminal:dev`，后端运行约 32 小时。
- **根因**：`packages/backend/src/infrastructure/ssh-suspend/local-suspended-session-log.adapter.ts`。挂起会话日志达到 100MB 上限后，**每一次 append 都把整个 ~100MB 文件重写一遍**（stream 拷贝到临时文件再 rename）。持续输出（全屏刷新 TUI）时，串行的日志 writer 队列无法排空，`SshSuspendService.prepareResume()` 中的 `await record.outputChain` / `logs.flush()` 长时间无法返回；恢复请求超过 45s 的 owner lease，`SshSuspendService.sweepExpiredOwnership()` 触发 `requestRevoke(..., 'lease_expired')`，`WorkspaceSuspendCoordinatorService.handleOwnershipRevoked()` 回滚 pending resume，协议 socket 以 4009 关闭，前端即表现为“恢复一直报错”。
- **证据**：
  - 直接对后端 WebSocket 发 `suspend.resume` 复现：约 46.5s 后收到 `{"type":"suspend.revoked","reason":"lease_expired","generation":12}`，随后 socket `closed 4009`。
  - 后端日志：`Workspace close rolled back pending resume`（`pendingResume:true, sessionExists:false`）。
  - `data/temp_suspended_ssh_logs/` 中存在多个 100MB 日志及持续生成/重写的 `.log.trim-*` 临时文件，宿主 `load average` ≈ 5。
  - `delete()`（终止挂起会话）也排在同一积压 writer 队列之后，因此同样被卡住，只能重启进程清除。
- **修复**：`31fe03b8 fix(terminal): amortize suspended session log compaction`。改为分批压缩：文件先增长 `TRIM_BATCH_BYTES`（32MB）再一次性裁剪一批，`append` 回到 O(1)，不再每 chunk 重写全文件。已用真实 adapter 验证：写入 150MB/1KB 分片只发生约 2 次压缩，`flush()` 0ms，文件稳定在 100–132MB，`readTail`/`readBefore` 正常；backend `tsc` 构建与 `pnpm run check` 通过。
- **闭环条件**：重新构建并部署包含该修复的 `dev` 镜像后，对一个持续输出（如全屏刷新 TUI）的挂起会话执行恢复，能够成功 commit、稳定交互且不再出现 `lease_expired` 撤销；线上验证通过后删除本条目。
