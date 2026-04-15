# ESLint Flat Config 迁移跟踪

> 启动时间：2026-04-15  
> 负责人：工程治理（并行修复模式）

## 背景

当前代码库全量 lint 已达成 `warnings=0 / errors=0`，但仍会出现如下迁移提示：

- `ESLintRCWarning: You are using an eslintrc configuration file ...`

该提示说明项目仍依赖旧配置体系（`.eslintrc.js` + `ESLINT_USE_FLAT_CONFIG=false`），需要迁移至 Flat Config。

## 目标

1. 引入并启用 `eslint.config.js`（Flat Config）。
2. 保持现有 lint 结果口径不回退（继续 `warnings=0 / errors=0`）。
3. 移除对 `ESLINT_USE_FLAT_CONFIG=false` 的依赖。

## 范围

- 根目录 lint 配置与脚本：
  - `.eslintrc.js`
  - `package.json`（`lint` 命令）
  - `.lintstagedrc.js`（如需）
- 受影响 workspace：
  - `packages/backend`
  - `packages/frontend`
  - `packages/remote-gateway`

## 执行计划（第一版）

1. 规则映射：把现有 `extends/plugins/rules/overrides` 映射到 Flat Config。
2. 分 workspace 校验：逐包跑 eslint，确保无新增 warning/error。
3. 全量校验：`npm run -s lint -- --format json`，确认总量仍为 0。
4. 清理兼容开关：去掉 `ESLINT_USE_FLAT_CONFIG=false`，统一走 Flat Config。

## 验收标准

- 运行 lint 不再输出 `ESLintRCWarning`。
- 全仓 `TOTAL_WARNINGS = 0`，`error = 0`。
- 文档（`CHANGELOG.md` 与 `TECHNICAL_DEBT_REPORT.md`）同步到最新口径。
