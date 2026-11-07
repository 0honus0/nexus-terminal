# 前端插件

## 1. 职责与范围

`features/agent/plugins` 对齐 backend/shared 的 `agent/plugins` 子功能归属，持 UI grant、MessagePort/SDK、可信父页面交互、插件 iframe 容器、插件市场和安装管理。通用 Agent Hub、App管理/集成/首次安装的组合设置容器保留原职责目录，直接import此模块真实owner。

## 2. 子功能与目录

- `sdk/`：对不可信 UI 公开的纯浏览器协议3 runtime，仅依赖 Shared 与本地ui-client。
- `host/`：可信Host桥、descriptor/RPC适配、iframe容器、Artifact选择及其本地类型。
- `api/`、`model/`：插件市场/安装/数据清除HTTP适配、展示类型、mapper与规则。
- `composables/`、`components/`：插件管理状态、市场/安装计划及设置面板。
- `../host/`：通用Hub/窗口/提醒/checkpoint状态，实际引用 `plugins/host/PluginAppFrame.vue`。

## 3. 依赖方向

sdk不可引用Host认证、HTTP、反馈、资源或Vue业务模块。Host层依赖真实认证、通用Agent API和窗口状态。独立UI只依赖Shared声明和公开URL `/sdk/frontend-v4.mjs`；不import此源码目录，不复用Host内部实现。

## 4. 类型与转换

公开factory/error/SDK/UI/stream/checkpoint契约唯一owner为Shared `agent/plugins`。Host专用descriptor投影及选择器DOM引用在host本地类型，不进入wire。UI自己的展示DTO和checkpoint schema仍由UI维护。

## 5. 入口与安装

sdk/index.ts是公开ESM资产构建入口；前端构建出部署资产，backend仅复制产物。没有单独plugin-frontend-sdk workspace/npm/tgz包。Host bridge由PluginAppFrame真实挂载，未保留旧目录reexport或按官方UI名分支。

## 6. 数据、事务与并发

目录迁移不改RPC/ACK/backpressure/operationId/unknown语义。可信批准重读、跨App文件选择、resource close与checkpoint隔离仍由原真实Host owner执行。

## 7. 生命周期与失败

协议3原grant expiry、ready/environment、取消、close/drain和流生命周期保留。独立UI从同一个公开ESM模块取得factory和错误构造器，避免内嵌另一份runtime造成instanceof失配。

## 8. 验证入口

总owner统一执行frontend/Shared检查、公开runtime构建、端口协议测试、独立UIcheck/build及原行为验收。当前目录迁移阶段只源码审阅和格式化，不声称任何新build或运行时PASS。
