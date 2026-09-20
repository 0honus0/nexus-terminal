# Nexus 当前问题清单

> 本文件只保留**尚未闭环、可执行、可验证**的问题。已完成问题不保留墓碑；历史完成记录以 Git 历史、`doc/PROGRESS.md` 的当前验证基线及对应设计/SRS 为准。

## 当前状态

截至 2026-09-20，本轮审计中已登记的问题（含最终 residual 审计新增的 P-121）当前均已闭环，本文件没有 open Problem。

这只表示本轮已登记、已验证的问题均已完成，不表示软件从此不存在任何缺陷。未来若出现新的代码证据、回归、产品行为缺口或用户明确提出新的审计目标，再新增可执行 Problem。

当前约定：

- 新问题继续从 `P-122` 起编号。
- 新 Problem 必须有当前代码事实、明确 owner、可验证完成条件，并优先补 deterministic regression。
- 问题闭环并完成验证后，直接从本文件删除，不保留“已完成”条目。
- 不为了编号连续性或“继续清理”而人为创建没有证据的问题。

## 明确规划 / Roadmap

明确属于 roadmap、design 或未来可选能力的内容**不作为当前 Problem 强制实施**，可以先不做；应继续留在对应设计/SRS 文档中管理，而不是混入缺陷清单。

已明确迁出的例子：

- Windows Desktop 规划：`doc/software-requirements/design/special-designs.md` 中的 `SD-DESKTOP-001`。

若后续规划被产品决策正式转成近期交付项，再按当时的真实代码与需求重新建立 Problem/任务，不从已完成问题的历史“目标方向”直接续做。

## 当前验证结论

最近一次已提交代码的 isolated deterministic Agent baseline 为 **68/68 PASS**；P-121 Backend typecheck/build 与 Agent Runner build PASS，最近涉及 Frontend 的 P-059 isolated `vue-tsc` / Vite build 也 PASS；Problem-scoped format 与 `git diff --check` 均已通过。

当前 worktree 仍保留一批**已审计但不应整批提交**的 residual：格式/展示排版、三语 i18n key 顺序、一个无 caller 的 Subagent context `maxBytes` 草稿，以及一份混有旧 fixture 的 runner 工作副本。它们不构成当前 open Problem，也不得用 `restore` / `reset` 等方式擅自清除；后续只有出现新的可执行代码证据时才重新建 Problem。

本机仍有两个环境层限制，不作为当前 open Problem 自动施工：

- 本机 Node 为 `v22.17.0`，仓库 engine 要求 `>=24`；正式 release/CI 以 Node 24 canonical environment 为准。
- 当前 Quick Commands canonical HTTP E2E 的隔离 Backend 启动会被现有 seeded DB 与累计 migration schema 不一致挡在测试逻辑之前；除非用户要求处理 E2E/seed 基础设施，暂不把它扩成新的产品 Problem。
