# 本体部署、开发与 SDK

## 部署

`docker-compose.yml` 默认使用 `dev` 镜像，宿主端口为 `18111`，数据保存在 `./data`。正式环境请明确选择镜像标签。

```sh
NEXUS_IMAGE_TAG=latest docker compose up -d
```

浏览器打开 `http://localhost:18111`，首次访问时创建管理员账户。对外使用时，通过支持 WebSocket 的 HTTPS 反向代理提供访问。

- 正式版镜像使用 `latest` 和版本号标签，由 `main` 的正式标签发布。
- 测试版镜像使用 `dev` 和版本标签，由 `dev` 分支的 `vMAJOR.MINOR.PATCH-dev` 或 `vMAJOR.MINOR.PATCH-dev.N` 发布。测试标签的数字部分与本体和 SDK 包版本一致。例如 `v0.0.1-dev.3` 使用本体版本 `0.0.1`，并附带 `nexus-terminal-0.0.1.tgz`。
- 每次发布另外生成 `sha-<commit>` 镜像。部署或测试需要固定本体时，使用这个标签。

当前安装文档面向新架构和全新数据目录。旧架构的数据目录与备份升级流程未验证。

## 本地开发

使用 Node.js 26.13.1 与 pnpm 12.18.0。在两个终端分别启动后端与前端。

```sh
pnpm install --frozen-lockfile
pnpm start:backend
pnpm start:frontend
```

前端默认监听 `9998`，后端默认监听 `9999`。后端开发数据默认写入 `.data`。需要使用其他后端时，给前端进程设置 `BACKEND_URL`。开发插件目录通过后端环境变量 `PLUGIN_DIRECTORIES` 传入 JSON 字符串数组。

```sh
pnpm check
pnpm test:unit
pnpm test:component
pnpm test:backend
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:sdk
```

## SDK 与插件市场

本体通过 GitHub Release 提供同版本的 `nexus-terminal-<版本>.tgz`。发布时会检查标签的版本号与本体 `package.json` 一致。开发插件时使用 SDK 的公开入口 `nexus-terminal/node`、`nexus-terminal/browser` 与 `nexus-terminal/browser/ui`。宿主提供 UI 运行时及样式，插件通过宿主公开 API 注册和消费能力。

插件市场从官方目录读取插件清单与校验信息，并独立管理插件安装、更新和卸载。

- [本体发布](https://github.com/0honus0/nexus-terminal/releases)
- [插件源码与发布说明](https://github.com/0honus0/nexus-plugin)
- [官方插件目录](https://raw.githubusercontent.com/0honus0/nexus-plugin/catalog/catalog.json)
