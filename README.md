![Nexus Terminal](https://lsky.tuyu.me/i/2025/04/30/681209e053db7.png)

<div align="center">

[![Docker](https://img.shields.io/badge/-Docker-2496ED?style=flat-square&logo=docker&logoColor=white)][docker-url]
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-4CAF50?style=flat-square)](./LICENSE)

[中文](./README.md) | [English](./doc/README_EN.md)

[docker-url]: https://github.com/0honus0/nexus-terminal/pkgs/container/nexus-terminal

</div>

## Nexus Terminal

**星枢终端（Nexus Terminal）** 是面向浏览器的 SSH / SFTP / RDP / VNC 远程连接工具，支持多会话终端、文件管理与在线编辑、远程桌面、安全认证、审计、移动端和界面定制。

- SSH / SFTP 多会话与文件管理
- RDP / VNC 远程桌面
- Monaco 在线编辑、文件预览、快捷命令与历史
- Passkey / 2FA / 验证码 / IP 访问控制 / 审计与通知
- 响应式移动端、PWA、主题与布局定制

更多功能见 [功能](./doc/FEATURES.md)。

## 功能截图

| SSH 终端 | 文件管理与在线编辑 |
| --- | --- |
| ![SSH 终端](./doc/imgs/e2e/ssh-terminal.png) | ![文件管理与在线编辑](./doc/imgs/e2e/file-manager-editor.png) |

| 主题定制 | 移动端工作区 |
| --- | --- |
| ![主题定制](./doc/imgs/e2e/theme-customization.png) | ![移动端工作区](./doc/imgs/e2e/mobile-workspace.png) |

## 快速开始

```bash
mkdir -p nexus-terminal && cd nexus-terminal
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/.env -O .env
docker compose up -d
```

默认访问端口为 `18111`。生产部署、环境变量、反向代理、更新与源码构建见 [部署文档](./doc/DEPLOYMENT.md)。

## 文档

- [文档](./doc/README.md)
- [功能](./doc/FEATURES.md)
- [部署与更新](./doc/DEPLOYMENT.md)
- [使用](./doc/USAGE.md)
- [E2E 测试](./verification/e2e/README.md)
- [English README](./doc/README_EN.md)

桌面端安装包请前往 [GitHub Releases](https://github.com/0honus0/nexus-terminal/releases/latest)。

## License

[GPL-3.0](./LICENSE)
