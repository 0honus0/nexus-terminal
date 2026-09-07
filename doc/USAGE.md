# 使用

## SSH 会话

### 挂起与恢复

SSH 标签页支持挂起会话。挂起后即使浏览器断开，后端仍可继续保持 SSH 会话；之后可以从挂起会话面板重新恢复。

适合编译、下载、长时间运行任务等不希望因浏览器断线而中断的场景。

### 自动重连

连接处于断开状态时，可以通过以下方式触发自动重连：

- 在命令输入框按回车。
- 在终端中按回车。
- 再次点击连接列表中的同一个 SSH 连接。

## 命令输入框

- `Alt + ↑/↓`：切换 SSH 会话标签页。
- `Alt + ←/→`：切换文本编辑器标签页。
- 开启命令同步后，命令输入可以同步到选定目标。
- `↑/↓` 可选择菜单中的历史或快捷命令项，`Enter` 发送。

## 终端

- `Ctrl + Shift + C`：复制。
- `Ctrl + Shift + V`：粘贴。
- 移动端支持双指缩放终端字体。

浏览器剪贴板能力通常要求 HTTPS 或 localhost 安全上下文。

## 文件管理器与在线编辑

文件管理器支持：

- 搜索后使用 `↑/↓` 快速选择文件。
- 从浏览器外拖入文件或文件夹进行上传。
- 在文件管理器内部拖动文件或目录完成移动。
- 使用 `Ctrl` / `Shift` 多选。
- 通过右键菜单执行复制、粘贴、剪切、删除、重命名、权限修改等操作。
- 桌面表格列使用 `Type / Name / Size / Permissions / Modified` 标题；列宽和行缩放可在设置中持久化。
- 使用 Monaco Editor 在线编辑文本文件。
- 预览 Markdown、图片、PDF、电子表格和 DOCX 等受支持文件。
- 上传、复制/移动、压缩和跨会话传输会进入共享进度模型；浮动进度窗可隐藏，隐藏任务可从 Progress Display 恢复或取消。

大量文件或深层目录上传时，建议先压缩后上传，减少浏览器一次性处理的文件数量。

## 历史命令

历史命令过长而被截断时，可以将鼠标悬停在命令上查看完整内容。

## 布局与通用操作

- 终端、文件管理器、文本编辑器和快捷指令视图支持 `Ctrl + 鼠标滚轮` 缩放。
- 布局管理器中的容器方向会直接反映在预览结构中：`水平` 容器的直接子节点横向排列，`垂直` 容器的直接子节点纵向排列；切换方向只改变该容器的子节点排列方向，不改变子节点本身的类型或内容。
- 展开的侧栏可以拖动调整宽度；桌面端没有活动会话时，左侧连接列表与空白 Workspace 之间的分界线同样支持左右拖动，并复用/持久化 Connection pane 宽度。默认点击 Workspace 其它区域会收回侧栏，开启“保持侧栏”偏好后才持续展开。
- File Manager / File Editor 的 popup 设置提供额外弹层入口，不复制文件系统或编辑器业务状态；embedded/sidebar presentation 仍使用同一 feature controller。
- File Manager 在很窄的 pane/sidebar 中会自动收起 `Size / Permissions / Modified` 次要列，只保留紧凑的文件类型图标与名称；恢复较宽 pane 后仍使用原来持久化的列宽。目录或搜索加载期间，加载动画显示在文件列表剩余区域中央。
- Quick Commands 的 Copy / Edit / Delete 行级操作通过右键菜单提供，不再在每一行末尾占用三个图标位置；单击指令行仍执行当前指令。
- SSH 标签栏和文件管理器标签栏支持右键菜单，包括关闭当前、关闭左侧、关闭其他、关闭右侧等操作。
- 标签分组中的名称可以直接点击修改。

## 状态监控与 Docker

- Status Monitor 默认显示在线状态而不是直接展示 IP；可在 Settings 中开启 IP 显示与复制。
- 状态采样间隔、缩放和 Docker 刷新间隔均由 Settings 持久化；默认 Docker 刷新间隔为 5 秒。
- Docker manager 在桌面宽 pane 使用表格，在窄 sidebar 使用卡片布局；Start/Stop/Restart/Remove 走 Docker capability，Enter/Logs 发送到当前 Workspace terminal。

## 外观与 HTML Theme

Style Customizer 支持本地 HTML theme 和 GitHub 目录形式的远程 HTML theme catalog。默认官方示例仓库指向 `assets/html-themes/remote/`；已知旧官方 `doc/custom_html_theme` / `examples/html-themes` URL 会在升级、保存、远程列表读取以及备份恢复后的初始化阶段归一到当前目录，因此恢复历史备份后不会再因旧官方目录不存在而返回 400；用户自行配置的第三方仓库不会被改写。

## 安全与认证

Nexus Terminal 支持多种认证和安全配置，包括：

- hCaptcha / Google reCAPTCHA。
- 2FA。
- Passkey / WebAuthn。
- IP 白名单与黑名单。
- 登录和异常通知。
- 审计日志。

Passkey 的部署域名配置见 [部署与更新](./DEPLOYMENT.md#passkey--webauthn)。

## 当前限制与注意事项

- 双文件管理器布局属于实验性能力，复杂场景可能存在边界行为。
- 同一布局中添加多个文本编辑器目前并非完整支持场景。
- 请自行备份部署目录中的 `data`；项目本身不替代外部备份方案。
- 生产访问建议启用 HTTPS。
