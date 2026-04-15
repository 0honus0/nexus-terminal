# ESLint Flat Config 迁移跟踪

> 启动时间：2026-04-15  
> 负责人：工程治理（并行修复模式）

## 背景

迁移前代码库虽已达成 `warnings=0 / errors=0`，但仍存在如下迁移提示：

- `ESLintRCWarning: You are using an eslintrc configuration file ...`

该提示说明项目仍依赖旧配置体系（`.eslintrc.js` + `ESLINT_USE_FLAT_CONFIG=false`），需要迁移至 Flat Config。

## 当前进展（2026-04-15，已完成）

### 第一阶段（已完成）

1. ✅ 新增并启用 `eslint.config.js`（最终收敛为纯 Flat Config）
2. ✅ `package.json` 与 `.lintstagedrc.js` 已移除 `ESLINT_USE_FLAT_CONFIG=false`
3. ✅ `.eslintignore` 已移除，忽略规则统一并入 `eslint.config.js`
4. ✅ `.eslintrc.js` 与 `eslint.legacy-config.cjs` 已下线
5. ✅ 已清理无引用 ESLint 旧依赖：`eslint-config-airbnb-base`、`eslint-config-airbnb-typescript`、`eslint-config-prettier`
6. ✅ 全量校验通过：`npm run -s lint -- --format json` => `errors=0 / warnings=0`
7. ✅ Vue SFC 覆盖扩展完成：移除 `**/*.vue` 忽略，`88` 个 `.vue` 文件纳入 lint 基础校验
8. ✅ 配置文件覆盖扩展完成：移除 `**/*.config.ts` 忽略，`9` 个配置文件纳入 lint 基础校验

### 第二阶段（已完成）

1. ✅ 将 `eslint.config.js` 从兼容模式收敛为纯 Flat Config
2. ✅ 下线 `eslint.legacy-config.cjs`，彻底消除兼容层

### 第三阶段（已完成）

1. ✅ 清理 Vue lint 覆盖盲区：`.vue` 不再被全局忽略
2. ✅ 启用 `vue-eslint-parser` + `prettier/prettier` 作为 Vue SFC 基础校验
3. ✅ 接入 `eslint-plugin-vue` `flat/essential` 基线规则（存量规则分批回收）

### 第四阶段（已完成）

1. ✅ 清理配置文件 lint 覆盖盲区：`*.config.ts` 不再被全局忽略
2. ✅ 为配置文件启用基础校验（`@typescript-eslint/parser` + `prettier/prettier` + `import` 插件）

### 第五阶段（已完成）

1. ✅ 回收 `vue/no-unused-vars`
2. ✅ 回收 `vue/use-v-on-exact`
3. ✅ 回收 `vue/multi-word-component-names`
4. ✅ 对应违规修复后，全量 lint 仍保持 `errors=0 / warnings=0`

### 第六阶段（已完成）

1. ✅ 回收 `vue/no-side-effects-in-computed-properties`
2. ✅ 通过“计算属性纯化 + watch 外置副作用”修复 3 处违规
3. ✅ 全量 lint 仍保持 `errors=0 / warnings=0`

### 第七阶段（已完成）

1. ✅ 回收 `vue/no-mutating-props`（严格模式）
2. ✅ 修复 2 处直接 prop 变更（`TagInput.vue`、`StyleCustomizerTerminalTab.vue`）
3. ✅ 完成 `AddConnectionFormAuth.vue`、`AddConnectionFormBasicInfo.vue`、`AddConnectionFormAdvanced.vue` 的 `emit patch` 改造
4. ✅ 移除全部临时豁免，`vue/no-mutating-props` 全量启用
5. ✅ 全量 lint 仍保持 `errors=0 / warnings=0`

## 目标

1. 引入并启用 `eslint.config.js`（Flat Config）。
2. 保持现有 lint 结果口径不回退（继续 `warnings=0 / errors=0`）。
3. 移除对 `ESLINT_USE_FLAT_CONFIG=false` 的依赖。

## 范围

- 根目录 lint 配置与脚本：
  - `eslint.config.js`
  - `.eslintrc.js`（历史文件，已下线）
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
5. ✅ 纯 Flat Config 收敛：移除 `eslint.legacy-config.cjs` 依赖，改为原生 Flat 配置。
6. ✅ Vue 覆盖扩展：`.vue` 文件纳入 lint 校验并保持 `errors=0 / warnings=0`。
7. ✅ Vue 基线增强：`flat/essential` 已接入且保持 `errors=0 / warnings=0`。
8. ✅ 配置文件覆盖扩展：`*.config.ts` 文件纳入 lint 校验并保持 `errors=0 / warnings=0`。
9. ✅ Vue 规则回收第二批：3 条规则恢复启用并保持 `errors=0 / warnings=0`。
10. ✅ Vue 规则回收第三批：`vue/no-side-effects-in-computed-properties` 已恢复启用并保持 `errors=0 / warnings=0`。
11. ✅ Vue 规则回收第四批：`vue/no-mutating-props` 已以严格模式全量恢复启用（无临时豁免）并保持 `errors=0 / warnings=0`。

## 验收标准

- 运行 lint 不再输出 `ESLintRCWarning`。
- 全仓 `TOTAL_WARNINGS = 0`，`error = 0`。
- 文档（`CHANGELOG.md` 与 `TECHNICAL_DEBT_REPORT.md`）同步到最新口径。
