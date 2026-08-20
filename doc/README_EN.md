<div align="center">

<h1>Nexus Terminal</h1>

[![Docker](https://img.shields.io/badge/-Docker-2496ED?style=flat-square&logo=docker&logoColor=white)][docker-url]
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-4CAF50?style=flat-square)](../LICENSE)

[中文](../README.md) | [English](./README_EN.md)

[docker-url]: https://github.com/0honus0/nexus-terminal/pkgs/container/nexus-terminal

</div>

## Quick Start

```bash
mkdir -p nexus-terminal && cd nexus-terminal

wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/{docker-compose.yml,.env}

docker compose up -d
```

Open `http://localhost:18111` · [Deployment & updates](./DEPLOYMENT.md)

## Features

A browser-based SSH / SFTP / RDP / VNC remote access tool with terminal sessions, file management, online editing, remote desktops, security controls, mobile support, and interface customization.

## Screenshots

### SSH Terminal

<p align="center">
  <img src="./imgs/e2e/ssh-terminal.png" alt="SSH terminal" width="100%">
</p>

### File Management & Online Editing

<p align="center">
  <img src="./imgs/e2e/file-manager-editor.png" alt="File management and online editing" width="100%">
</p>

### Theme Customization

<p align="center">
  <img src="./imgs/e2e/theme-customization.png" alt="Theme customization" width="100%">
</p>

### Mobile

<p align="center">
  <img src="./imgs/e2e/mobile-workspace.png" alt="Mobile workspace" width="360">
</p>

## Documentation

[Features](./FEATURES.md) · [Usage](./USAGE.md) · [Deployment & updates](./DEPLOYMENT.md) · [E2E](../test/e2e/README.md) · [中文](../README.md)

## License

[GPL-3.0](../LICENSE)
