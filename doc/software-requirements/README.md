# Nexus Terminal 软件需求

本目录是 Nexus Terminal 当前软件需求规格与历史追溯入口。

## 阅读顺序

1. [SRS 主规格](SRS.md) — 模块目录、范围、解释规则。
2. `requirements/` — 各模块主需求表，格式统一为 **需求编号 / 功能 / 详细需求 / 特殊设计与约束 / 来源 / 状态**。
3. [FR 追溯表](traceability/functional-requirements.md) — 点击主需求中的 `FR-*` 返回功能基线。
4. [GREQ 追溯表](traceability/git-requirements.md) — 点击主需求中的 `GREQ-*` 查看 Git 派生细节、旧设计审查、当前实现与状态。
5. [Git 历史证据索引](traceability/git-history.md) — 从 commit 反向查关联 GREQ。
6. [特殊设计与系统级约束](design/special-designs.md) — 生命周期、并发、安全、状态 owner、测试和性能等跨模块约束。

## 目录结构

```text
doc/software-requirements/
├── README.md
├── SRS.md
├── requirements/
│   ├── identity-security.md
│   ├── connections.md
│   ├── workspace.md
│   ├── transfers.md
│   └── ...
├── traceability/
│   ├── functional-requirements.md
│   ├── git-requirements.md
│   └── git-history.md
└── design/
    └── special-designs.md
```

## 链接规则

- 主需求表只引用 FR/GREQ 链接，不复制完整历史说明。
- FR/GREQ 表均使用稳定显式 anchor，可双向跳转。
- GREQ 中识别到的 commit hash 链接到 GitHub 对应 commit。
- 原始重构文档继续作为底层证据保留，不在本目录复制一份形成第二事实源。

统计：**123 条 FR / SRS 主需求，104 条 GREQ。**
