# 安全审计报告 (2026-01-31)

## 概览

- **审计时间**: 2026-01-31 15:40:00 CST
- **总漏洞数**: 34 个
- **严重程度分布**:
  - 高危 (HIGH): 17 个
  - 中危 (MODERATE): 7 个
  - 低危 (LOW): 10 个

## 漏洞分类

### 🔴 高危漏洞 (17)

#### fast-xml-parser (DoS 攻击)

- **CVE**: GHSA-37qj-frw5-hhjh
- **受影响版本**: 4.3.6 - 5.3.3
- **问题描述**: RangeError DoS Numeric Entities Bug
- **影响范围**: 16 个 AWS SDK 包
  - @aws-sdk/client-ses
  - @aws-sdk/client-sso
  - @aws-sdk/core
  - @aws-sdk/credential-provider-\* (8 个子包)
  - @aws-sdk/middleware-user-agent
  - @aws-sdk/nested-clients
  - @aws-sdk/token-providers
  - @aws-sdk/util-user-agent-node
  - @aws-sdk/xml-builder
- **修复方案**: 等待 AWS SDK 官方更新依赖
- **业务影响**: Email 通知模块 (packages/backend/src/notification/email.service.ts)
- **缓解措施**:
  - 当前仅用于发送邮件通知,不处理外部 XML 输入
  - 建议监控 AWS SDK 更新,在 v3.900+ 版本发布后升级

### 📊 依赖链分析

```
fast-xml-parser@4.3.6-5.3.3
  ↓
@aws-sdk/xml-builder >= 3.894.0
  ↓
@aws-sdk/core >= 3.894.0
  ↓
@aws-sdk/client-ses >= 3.894.0 (实际使用)
```

---

### 🟡 中危漏洞 (7)

#### ESLint (栈溢出)

- **CVE**: GHSA-p5wg-g6qr-c7cg
- **受影响版本**: < 9.26.0
- **当前版本**: 8.57.1 (已 EOL)
- **问题描述**: 序列化循环引用对象时栈溢出
- **影响范围**:
  - eslint
  - @typescript-eslint/eslint-plugin
  - @typescript-eslint/parser
  - @typescript-eslint/type-utils
  - @typescript-eslint/utils
  - eslint-config-airbnb-base
  - eslint-config-airbnb-typescript
- **修复方案**: 升级到 ESLint 9.26.0+
- **破坏性变更**:
  - ESLint 9.x 引入了新的配置格式 (Flat Config)
  - TypeScript ESLint 插件需要同步升级到 v8+
  - Airbnb 配置可能需要更新
- **业务影响**: 仅影响开发环境,不影响生产运行
- **建议操作**:
  - 创建独立分支进行升级测试
  - 优先级: 低(开发工具,非运行时依赖)

---

### 🟢 低危漏洞 (10)

#### cookie (边界字符处理)

- **CVE**: GHSA-pxg6-pf52-xh8x
- **受影响版本**: < 0.7.0
- **影响范围**: @sentry/node (错误监控)
- **业务影响**: 极低(仅用于开发环境错误追踪)

#### vue@2 (ReDoS)

- **CVE**: GHSA-5j4c-8p2g-v4jx
- **受影响版本**: 2.0.0 - 2.7.16
- **影响范围**: @types/splitpanes (类型定义依赖)
- **业务影响**: 无(仅类型定义,不参与运行时)
- **备注**: 项目主应用使用 Vue 3,此为类型依赖

#### tmp (符号链接漏洞)

- **CVE**: GHSA-52f5-9888-hmc6
- **受影响版本**: <= 0.2.3
- **影响范围**: @lhci/cli (Lighthouse CI 工具)
- **业务影响**: 无(开发工具,不参与生产部署)

#### 其他低危漏洞

- external-editor: 依赖 tmp
- inquirer: 依赖 external-editor
- lighthouse: 依赖 @sentry/node
- @lhci/utils: 依赖 lighthouse
- @lhci/cli: 测试工具

---

## 修复优先级

### P0 - 立即处理

- 无(当前漏洞均不影响生产环境安全)

### P1 - 下个迭代 (1-2 周)

- [ ] 升级 AWS SDK 到 v3.900+ (修复 fast-xml-parser DoS)
  - 测试邮件发送功能 (Email 通知模块)
  - 验证 SES API 兼容性

### P2 - 季度规划 (1-3 月)

- [ ] 升级 ESLint 到 v9.26.0+
  - 迁移到 Flat Config
  - 更新 TypeScript ESLint 插件到 v8+
  - 重新配置 Airbnb 规则集
  - 修复所有新检查规则的 lint 错误

### P3 - 技术债务清理

- [ ] 移除未使用的开发依赖 (@lhci/cli, lighthouse)
- [ ] 审查 @types/splitpanes 的必要性(项目是否实际使用 splitpanes 组件)
- [ ] 替换 xterm@5.3.0 为 @xterm/xterm (见 TECHNICAL_DEBT_REPORT.md)

---

## 缓解措施

### 当前已实施

1. **AWS SDK 使用限制**:
   - 仅用于发送邮件通知,不处理外部 XML 输入
   - 邮件内容已进行输入校验和转义

2. **ESLint 使用限制**:
   - 仅在开发环境使用,不参与生产构建
   - CI/CD 流程中已隔离 lint 错误

3. **开发工具隔离**:
   - Lighthouse CI 工具未在生产环境部署
   - tmp/inquirer 仅在本地开发使用

### 建议补充

1. **依赖监控**:
   - 配置 GitHub Dependabot 自动检测依赖更新
   - 每周审查安全公告

2. **运行时保护**:
   - 添加邮件发送速率限制(防止 DoS 利用)
   - 记录异常邮件发送行为

---

## 升级测试检查清单

### AWS SDK 升级

- [ ] 备份当前 package-lock.json
- [ ] 升级 @aws-sdk/client-ses 到最新版本
- [ ] 运行单元测试: `npm test -- email.service.test.ts`
- [ ] 手动测试邮件发送功能
- [ ] 验证所有通知渠道正常工作
- [ ] 回归测试: 用户注册、密码重置、登录提醒

### ESLint 升级

- [ ] 创建升级分支 `chore/eslint-v9-migration`
- [ ] 安装 ESLint 9.26.0+ 和相关插件
- [ ] 迁移配置到 Flat Config (eslint.config.js)
- [ ] 运行 `npm run lint` 并修复所有错误
- [ ] 验证 VS Code ESLint 扩展兼容性
- [ ] CI 流程测试

---

## 附录

### 完整漏洞列表

```
HIGH (17):
- @aws-sdk/client-ses
- @aws-sdk/client-sso
- @aws-sdk/core
- @aws-sdk/credential-provider-env
- @aws-sdk/credential-provider-http
- @aws-sdk/credential-provider-ini
- @aws-sdk/credential-provider-login
- @aws-sdk/credential-provider-node
- @aws-sdk/credential-provider-process
- @aws-sdk/credential-provider-sso
- @aws-sdk/credential-provider-web-identity
- @aws-sdk/middleware-user-agent
- @aws-sdk/nested-clients
- @aws-sdk/token-providers
- @aws-sdk/util-user-agent-node
- @aws-sdk/xml-builder
- fast-xml-parser

MODERATE (7):
- @typescript-eslint/eslint-plugin
- @typescript-eslint/parser
- @typescript-eslint/type-utils
- @typescript-eslint/utils
- eslint
- eslint-config-airbnb-base
- eslint-config-airbnb-typescript

LOW (10):
- @lhci/cli
- @lhci/utils
- @sentry/node
- @types/splitpanes
- cookie
- external-editor
- inquirer
- lighthouse
- tmp
- vue
```

### 参考资料

- [npm audit 文档](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [GitHub Advisory Database](https://github.com/advisories)
- [ESLint 9.0 迁移指南](https://eslint.org/docs/latest/use/migrate-to-9.0.0)
- [AWS SDK for JavaScript v3 更新日志](https://github.com/aws/aws-sdk-js-v3/releases)

---

**报告生成**: 2026-01-31 15:42:00 CST
**生成工具**: npm audit + 人工分析
**下次审计**: 2026-02-28
