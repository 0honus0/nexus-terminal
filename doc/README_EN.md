![banner.png](https://lsky.tuyu.me/i/2025/04/30/681209e053db7.png)

---

<div align="center">

[![Docker](https://img.shields.io/badge/-Docker-2496ED?style=flat-square&logo=docker&logoColor=white)][docker-url] [![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-4CAF50?style=flat-square)](https://github.com/Silentely/nexus-terminal/blob/main/LICENSE)

[docker-url]: https://ghcr.io/silentely/nexus-terminal-frontend

</div>

## 📖 Overview

**Nexus Terminal** is a modern, feature-rich web-based SSH / RDP / VNC client dedicated to providing a highly customizable remote connection experience.

## 🔀 Differences from Upstream

> This project is forked from [Heavrnl/nexus-terminal](https://github.com/Heavrnl/nexus-terminal).
> Upstream baseline: `Heavrnl/nexus-terminal:main`
> Snapshot (2026-04-25): this fork is `ahead 369+ / behind 0` vs upstream.
> Compare URL: <https://github.com/Heavrnl/nexus-terminal/compare/main...Silentely:main>

### ✅ Verifiable Current State

- `npm run -s debt:check` passes (code markers / E2E skip / console.log / any = 0)
- `npm run -s quality:check` passes (debt + 3-way typecheck + lint + format)
- `import/no-cycle` controlled waivers converged to 0
- 2026-04-24 full audit: 24/26 items fixed (92%), remaining L4/L6 pending planning

---

Below is a long-term summary of this fork's enhancements compared to upstream:

### ⚡ Performance Optimizations

| Optimization                          | Effect                                                                                                                      |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| **SSH Terminal Input Latency**        | Reduced from 72-232ms to <3ms (**98% improvement**), separating small packet direct-write from large packet batch buffering |
| **App Startup Performance**           | Unified initialization API, merging 3-4 network requests into 1, eliminating white-screen waiting                           |
| **FileManager Virtual Scrolling**     | Auto-enabled when connections exceed 50, smooth rendering for massive file lists                                            |
| **Command History Virtual Scrolling** | Smooth rendering of thousands of history records without lag                                                                |
| **Frontend Lazy Loading**             | RDP/VNC components loaded on-demand, guacamole dependency (~200KB) no longer blocks initial render                          |
| **SQLite WAL Mode**                   | Enabled WAL mode for optimized concurrent read/write, reduced lock contention                                               |
| **Audit Log Probabilistic Cleanup**   | Triggered every 100 writes instead of every write, eliminating unnecessary cleanup overhead                                 |

### 🛠️ New Features

- **Terminal Appearance Live Preview**: Real-time preview window in appearance settings for font, theme, stroke, and shadow changes
- **Force Keyboard-Interactive Auth**: New `keyboard-interactive` option for SSH connections, supporting TOTP/2FA server authentication
- **NL2CMD Natural Language Commands**: Multi-model integration (OpenAI/Claude/Gemini), converting natural language directly to terminal commands
- **Configurable Rate Limiting**: Flexible API rate limit control via environment variables (including dedicated AI route rate limiting)
- **Unified Cache Manager**: Type-safe localStorage operations with version control and TTL expiration management
- **Unified Error Extractor**: Eliminated duplicated error extraction patterns with globally unified error handling
- **Health Check Endpoint**: `/api/v1/health` checks SQLite connectivity, WebSocket status, disk space, and memory usage
- **Structured Logging**: JSON structured log output for log aggregation and analysis
- **Prometheus Metrics Endpoint**: Built-in application metrics collection, compatible with Grafana and other monitoring platforms
- **Data Import**: Settings page supports data import (alongside existing export), with database backup download
- **Command Palette**: Built-in Command Palette component for quick action search and execution

### 🏗️ Architecture Refactoring

- **Technical Debt Fully Governed**: Historical 24/24 items cleared + 2026-04-24 audit 24/26 items fixed (92%)
- **Type Safety Governance**: All `@ts-ignore` removed, `any` and weak typing cleared within business source code
- **SFTP Service Deep Decomposition**: `sftp.service.ts` reduced from 1884 to 243 lines (**-87%**), split into readdir/move/copy/path-operations/session executor modules
- **Auth Controller Layered Refactoring**: `auth.controller.ts` reduced from 1592 to 1366 lines (**-14%**), split into login/passkey/2FA/password action-layer utils with SQL assembly unified
- **Cycle Dependencies Zeroed**: `import/no-cycle` controlled waivers converged from 16 to 0, decoupling auth chain, DB init chain, and notification chain
- **FileManager Component Decomposition**: From 2851 lines split into composable functions (sort/filter, path navigation, column resize, layout settings, clipboard, item actions, action modal, download)
- **Repository Base Class**: Unified Repository-layer error handling and logging, benefiting 15+ files
- **Typed Error Hierarchy**: Added `DatabaseError`, `ValidationError`, `ExternalServiceError` type-safe error subclasses
- **ESLint Flat Config Migration**: Completed migration to Flat Config, legacy config paths fully removed, Vue SFCs fully linted
- **CSP Security Headers**: Added Content-Security-Policy / X-Frame-Options / X-Content-Type-Options
- **Unified Error Response Format**: Global ErrorResponse type, eliminating `{ message }` vs `{ success, error }` inconsistency
- **Security Config Environment Variables**: `security.config.ts` supports env var overrides, no longer hardcoded
- **Docker Compose Production-Ready**: Added healthcheck, resource limits, restart policy, and log rotation

### 🧪 Test Coverage

- **Comprehensive Test Framework**: From near-zero tests to 1500+ test cases, 100% pass rate
- **E2E Tests (Playwright)**: 8 test specs covering auth, SSH, SFTP, remote desktop, and edge cases
- **Integration Tests**: SSH/SFTP mock servers, Guacamole protocol tests, Remote Gateway tests
- **Unit Tests**: Backend 123 test files, Frontend 47 test files
- **New Store Tests**: settings / fileEditor / audit store test coverage
- **New Controller Tests**: 39 test cases for settings.controller
- **Quality Gate**: `quality:check` covers debt + 3-way typecheck + lint + format

### 🔒 Dependency Security

- **Audit Cleared (2026-04-13)**: `npm audit --omit=dev` and `npm audit` both at 0 (critical/high/moderate/low all cleared)
- **Critical Vulnerability Fixes**: Proactively patched known high-severity vulnerabilities in axios, qs, tar (CVE/GHSA)
- **Dependabot Automation**: Configured automatic dependency updates for continuous security monitoring
- **Dependency Overrides**: Enforced secure versions via npm overrides
- **XSS Protection**: AI panel migrated to DOMPurify, SFTP compress/decompress added path whitelist validation

---

## ✨ Features

- Manage SSH and SFTP connections with multiple tabs
- Support remote access to desktops via RDP/VNC protocol
- Utilizes Monaco Editor for online file editing
- Integrated multi-factor login security mechanisms, including human verification (hCaptcha, Google reCAPTCHA) and two-factor authentication (2FA)
- Highly customizable interface themes and layout styles
- Built-in simple Docker container management panel for easy container operations
- Supports IP whitelisting and blacklisting, with automatic banning for abnormal access
- Notification system (e.g., login reminders, anomaly alerts)
- Audit logs for comprehensive recording of user behavior and system changes
- Lightweight Node.js-based backend with low resource consumption
- Supports PWA
- Built-in heartbeat keep-alive mechanism to ensure stable connections
- Focus Switcher: Allows switching between input components on the page, supporting customizable switching order and hotkeys.
- **Batch Command Execution**: Execute commands across multiple servers simultaneously with real-time progress and results display
- **AI Smart Assistant**: Built-in AI operations analysis providing system health diagnostics, command pattern analysis, and security event detection

## 📸 Screenshots

|                           Login Interface                            |
| :------------------------------------------------------------------: |
| ![Login_en.png](https://lsky.tuyu.me/i/2025/04/30/68123e4016788.png) |

---

|                            Terminal Interface                            |
| :----------------------------------------------------------------------: |
| ![workspace_en.png](https://lsky.tuyu.me/i/2025/04/30/68123e410d34f.png) |

---

|                          Style Settings                           |                            Layout Settings                            |                             Settings Panel                              |
| :---------------------------------------------------------------: | :-------------------------------------------------------------------: | :---------------------------------------------------------------------: |
| ![ui_en.png](https://lsky.tuyu.me/i/2025/04/30/68123e40570cc.png) | ![layout_en.png](https://lsky.tuyu.me/i/2025/04/30/68123e4122276.png) | ![settings_en.png](https://lsky.tuyu.me/i/2025/04/30/68123e4036cd6.png) |

## 🚀 Quick Start

### 1️⃣ Configure Environment

> It is recommended to deploy in a Debian (AMD64 architecture) environment. Since I do not have an ARM device, compatibility with ARM is not guaranteed.

Create a new folder

```bash
mkdir ./nexus-terminal && cd ./nexus-terminal
```

---

Download the [**docker-compose.yml**](https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/docker-compose.yml) and [**.env**](https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/.env) files from the repository to your current directory.

```bash
wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml && wget https://raw.githubusercontent.com/Silentely/nexus-terminal/refs/heads/main/.env -O .env
```

> The default image registry is GitHub Container Registry (GHCR), namespace: `ghcr.io/silentely`.

> ⚠️ **Note:**
>
> - For **arm64** users, replace `guacamole/guacd:latest` with `guacamole/guacd:1.6.0-RC1` in the `docker-compose.yml` file.
> - For **armv7** users, please refer to the additional notes below.

Configure nginx

```conf
location / {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_redirect off;
    proxy_pass http://127.0.0.1:18111;
}
```

Configure IPv6 for Docker (optional — you can skip this if you don't use IPv6 to connect to the server).

Add the following content to `/etc/docker/daemon.json`:

```json
{
  "ipv6": true,
  "fixed-cidr-v6": "fd00::/80",
  "ip6tables": true,
  "experimental": true
}
```

Then restart the Docker service:

```
sudo systemctl restart docker
```

### 2️⃣ Start the Service

```bash
docker compose up -d
```

### 3️⃣ Update

Note: Running with docker-compose does not require pulling the source code unless you plan to build it yourself. Simply execute the following commands in the project directory to update.

```bash
docker compose down
```

```bash
docker compose pull
```

```bash
docker compose up -d
```

## 📚 Usage Guide

### Suspend Session Component

You can right-click in the SSH tab to select "Suspend Session" (long-press on mobile). Once suspended, even if the web connection is lost, the backend will automatically take over and keep the SSH connection active. You can resume the session at any time via the panel. This ensures that tasks such as compilation or long-running processes won’t be interrupted due to network issues.

### Command Input Component

1.  **Tab Switching**: When the command input box has focus, use `Alt + ↑/↓` to switch between SSH session tabs, and `Alt + ←/→` to switch between text editor tabs.
2.  **Command Sync** (needs to be enabled in settings): When enabled, text entered in the command input box will be synchronized in real-time to the selected target input source. Use the `↑/↓` keys to select menu command items, then press `Enter` to send the selected command.

### File Manager Component

1.  **Quick File Selection**: When the file search box has focus, you can use the `↑/↓` keys to quickly select files.
2.  **Drag and Drop Upload**: Supports dragging files or folders from outside the browser for uploading. **Note:** When uploading a large number of files or deeply nested folders, it is recommended to compress them first to avoid browser freezes.
3.  **Internal Drag and Drop**: You can directly drag and drop files or folders within the file manager to move them.
4.  **Multiple Selection**: Hold down the `Ctrl` or `Shift` key to select multiple files or folders.
5.  **Context Menu**: Provides common file operations such as copy, paste, cut, delete, rename, and modify permissions.
6.  **Sync to Terminal Directory**: Click the toolbar folder button to switch the file manager to the current terminal working directory. The backend reads from the active interactive shell and includes shell-specific fallbacks (`posix`/`fish`/`powershell`/`cmd`).

### Command History Component

1.  **View Full Command**: When a historical command is too long and truncated, hover the mouse over the command to view the complete instruction content.

### Terminal Component

1. Press **Ctrl + Shift + C** to copy, and **Ctrl + Shift + V** to paste.

### General Operations

1.  **Zoom**: In the terminal, file manager, text editor components, and quick command view, you can use `Ctrl + mouse wheel` to zoom.
2.  **Sidebar**: The expanded sidebar can have its width adjusted by dragging.
3.  **Tab Bar**: Right-clicking on the SSH tab bar or the file manager tab bar will open a context menu with the following options: Close, Close Tabs to the Left, Close Other Tabs, and Close Tabs to the Right.
4.  **Tab Group Fold Bar**: You can directly click on the tab name in the view to rename the tab.
5.  **Automatic Reconnection**: When the connection is lost, you can press Enter in the command input box or terminal, or click the same SSH connection in the connection list to trigger automatic reconnection.

### Command Palette

1.  **Open**: Press `Ctrl + K` (or `Cmd + K` on macOS) to open the command palette. Press `ESC` or click the overlay to close it.
2.  **Search Connections**: Type keywords in the search box to quickly filter saved connections and jump to the workspace to establish a connection.
3.  **Page Navigation**: Quickly navigate to the Dashboard, Connections, Settings, and other pages.
4.  **Theme Switching**: Switch between dark and light themes directly from the command palette.
5.  **Keyboard Navigation**: Use `↑` `↓` arrow keys to browse options, and press `Enter` to confirm and execute.

### Batch Command Execution Component

1. **Select Servers**: In the batch execution panel, check the SSH connections you want to execute commands on, with support for select all/deselect all
2. **Enter Command**: Type the command to execute in the command input box, with sudo mode support
3. **Concurrency Control**: Adjust the concurrency limit (default 5) to control the number of simultaneous tasks
4. **Real-time Progress**: View each server's status and overall progress during execution
5. **View Output**: Click the "View" button to see the command output for individual servers
6. **Cancel Task**: Cancel all uncompleted tasks at any time during execution

### AI Smart Assistant Component

1. **Quick Queries**: Click preset suggestions to quickly query system health, command patterns, security events, etc.
2. **Natural Language Interaction**: Ask questions directly, and the AI assistant will analyze and return relevant data
3. **Session History**: Click the history button to view and restore previous sessions
4. **Smart Insights**: AI automatically generates actionable suggestions, categorized by severity level

### Others

1. **On mobile devices, you can zoom in or out on the terminal font using a two-finger gesture.**
2. Due to browser limitations, copying terminal content is not available over non-HTTPS or non-localhost connections. Please use HTTPS.
3. To enable Passkey login, set `RP_ID` and `RP_ORIGIN` in `.env`. For "one passkey across multiple independent domains", use a single `RP_ID` with multiple `RP_ORIGIN` values and expose `/.well-known/webauthn`.

## ⚠️ Notes

1.  **Dual File Managers**: You can add two file manager components in the layout (experimental feature, may be unstable).
2.  **Multiple Text Editors**: The functionality to add multiple text editors in the same layout has not yet been implemented.
3.  For **ARMv7** users, please use the [docker-compose.yml](https://github.com/Silentely/nexus-terminal/blob/main/doc/arm/docker-compose.yml) provided here.
    Since Apache Guacamole does not provide an ARMv7-compatible image for `guacd`, the RDP/VNC feature has been disabled, and related images will not be pulled for now.
4.  Since I don't have an ARM machine on hand, I haven't conducted actual testing, so unexpected bugs may occur during runtime.
5.  For data backup, please back up the **data** folder in the directory yourself. This project does not provide any backup functionality.

## 💐 Acknowledgements

- The preset theme schemes are based on the excellent [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) project.

## ☕ Donate

If you find this project helpful, feel free to buy me a coffee through the following ways:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/W7W01GGLJU)

## AI-assisted issue triage

This repository uses an AI-assisted issue triage workflow to:

- identify likely deployment, reverse proxy, auth, and protocol-specific issues
- suggest concrete troubleshooting steps
- point reporters to the most relevant documentation
- propose implementation plans for likely defects

The assistant may reply with troubleshooting steps or request minimal additional information.
Code changes are not proposed automatically unless a maintainer explicitly requests implementation.

## 📄 License

This project is licensed under the [GPL-3.0](LICENSE) license. See the [LICENSE](LICENSE) file for details.
