# ESLint Flat Config 迁移跟踪

> 启动时间：2026-04-15  
> 负责人：工程治理（并行修复模式）

## 背景

迁移前代码库虽已达成 `warnings=0 / errors=0`，但仍存在如下迁移提示：

- `ESLintRCWarning: You are using an eslintrc configuration file ...`

该提示说明项目仍依赖旧配置体系（`.eslintrc.js` + `ESLINT_USE_FLAT_CONFIG=false`），需要迁移至 Flat Config。

## 当前进展（2026-04-15）

### 第一阶段（已完成）

1. ✅ 新增并启用 `eslint.config.js`（使用 `FlatCompat` 承接现有规则，避免一次性重写）
2. ✅ `package.json` 与 `.lintstagedrc.js` 已移除 `ESLINT_USE_FLAT_CONFIG=false`
3. ✅ `.eslintignore` 已移除，忽略规则统一并入 `eslint.config.js`
4. ✅ 全量校验通过：`npm run -s lint -- --format json` => `errors=0 / warnings=0`

### 第二阶段（进行中）

1. 将 `eslint.config.js` 从兼容模式（`FlatCompat + .eslintrc.js`）收敛为纯 Flat Config
2. 下线 `.eslintrc.js`，彻底消除双配置源

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

## 执行计划（更新）

1. ✅ 规则映射：把现有 `extends/plugins/rules/overrides` 映射到 Flat Config（兼容模式）。
2. ✅ 分 workspace 校验：逐包验证无新增 warning/error。
3. ✅ 全量校验：`npm run -s lint -- --format json`，总量保持 0。
4. ✅ 清理兼容开关：去掉脚本中的 `ESLINT_USE_FLAT_CONFIG=false`。
5. ⏳ 纯 Flat Config 收敛：移除 `.eslintrc.js` 依赖，改为原生 Flat 配置。

## 验收标准

- 运行 lint 不再输出 `ESLintRCWarning`。
- 全仓 `TOTAL_WARNINGS = 0`，`error = 0`。
- 文档（`CHANGELOG.md` 与 `TECHNICAL_DEBT_REPORT.md`）同步到最新口径。
