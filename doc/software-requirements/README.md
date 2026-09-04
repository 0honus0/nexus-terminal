# Nexus Terminal 软件需求

本目录是 Nexus Terminal 当前软件需求规格与历史追溯入口。

## 阅读顺序

1. [SRS 主规格](SRS.md) — 模块目录、范围、解释规则。
2. [工程约束表](engineering-constraints.md) — 全仓库唯一强制工程约束源，每条使用稳定 `EC-*` ID，可被 SRS、架构、测试和实现文档直接引用。
3. `requirements/` — 各模块主需求表，格式统一为 **需求编号 / 功能 / 详细需求 / 特殊设计 / 适用工程约束 / 来源 / 状态**。
4. [FR 追溯表](traceability/functional-requirements.md) — 点击主需求中的 `FR-*` 返回功能基线。
5. [GREQ 追溯表](traceability/git-requirements.md) — 点击主需求中的 `GREQ-*` 查看 Git 派生细节、旧设计审查、当前实现与状态。
6. [Git 历史证据索引](traceability/git-history.md) — 从 commit 反向查关联 GREQ。
7. [特殊设计与系统级要求](design/special-designs.md) — 生命周期、并发、安全、状态 owner、测试、诊断和性能等跨模块软件设计要求；强制工程约束只引用 `EC-*`。

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
├── engineering-constraints.md
└── design/
    └── special-designs.md
```

## 链接规则

- [工程约束表](engineering-constraints.md) 是全仓库唯一强制工程约束登记表；本 SRS 可以定义产品/软件能力和设计要求，但不得复制工程约束正文形成第二规范源，只引用稳定的 `EC-*`。 `OWNER` 行表示项目 Owner 的历史明确输入；后续输入与 `OWNER` 冲突时必须先按 [EC-META-001](engineering-constraints.md#ec-meta-001) 交由 Owner 决策。
- 主需求表只引用 FR/GREQ 链接，不复制完整历史说明。
- FR/GREQ 表均使用稳定显式 anchor，可双向跳转。
- GREQ 中识别到的 commit hash 链接到 GitHub 对应 commit。
- 原始重构文档继续作为底层证据保留，不在本目录复制一份形成第二事实源。

统计：**123 条 FR / SRS 主需求，104 条 GREQ。**
