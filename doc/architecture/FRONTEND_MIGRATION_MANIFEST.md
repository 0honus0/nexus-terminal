# Frontend Rewrite Migration Manifest

This manifest maps old implementation areas to final owners. It is a rewrite checklist, not a file-move list.

## App composition

| Old source                | Final owner                                                 | Rewrite note                                                                              |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `main.ts`                 | `app/main.ts` + `app/bootstrap/`                            | bootstrap auth/settings/appearance without stores constructing each other                 |
| `App.vue`                 | `app/App.vue` + `app/shell/`                                | navigation/global hosts only; Workspace runtime owns Workspace shortcuts/session recovery |
| `router/index.ts`         | `app/router/`                                               | guards consume Auth public state; router is never imported by client/store                |
| `views/DashboardView.vue` | `app/pages/dashboard/`                                      | page composition over Connections/Tags/Audit/System Overview public APIs                  |
| `views/SettingsView.vue`  | `app/pages/settings/`                                       | page composition over Security/Preferences/Backup/Appearance/Workspace settings           |
| `views/TagsView.vue`      | delete unless a user-visible route is deliberately restored | old route is commented out                                                                |

## Identity/security

| Old source                                                                                                                | Final owner                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `views/LoginView.vue`, `views/SetupView.vue`                                                                              | `features/auth`                                                                         |
| auth session/login/setup parts of `stores/auth.store.ts`                                                                  | `features/auth`                                                                         |
| password/2FA/passkey-management parts of `stores/auth.store.ts` and settings composables                                  | `features/security`                                                                     |
| `ChangePasswordForm.vue`                                                                                                  | `features/security`                                                                     |
| `TwoFactorAuthSettings.vue`                                                                                               | `features/security`                                                                     |
| `PasskeyManagement.vue`                                                                                                   | `features/security`                                                                     |
| `CaptchaSettingsForm.vue`                                                                                                 | `features/security`                                                                     |
| `IpWhitelistSettings.vue`, `IpBlacklistSettings.vue`                                                                      | `features/security`                                                                     |
| `useChangePassword`, `useTwoFactorAuth`, `usePasskeyManagement`, `useCaptchaSettings`, `useIpWhitelist`, `useIpBlacklist` | corresponding `features/security/composables` only if view coordination is still needed |

## Connection catalog

| Old source                                                                              | Final owner                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `stores/connections.store.ts`                                                           | `features/connections` clean catalog state/API                              |
| `views/ConnectionsView.vue`                                                             | Connections route composition / `features/connections/components`           |
| `AddConnectionForm*.vue`, `useAddConnectionForm.ts`                                     | `features/connections` rewritten into smaller form model + sections         |
| `BatchEditConnectionForm.vue`                                                           | `features/connections`                                                      |
| `WorkspaceConnectionList.vue`                                                           | `runtimes/workspace/components` using Connections public surface            |
| `ConnectionList.vue`                                                                    | delete unless behavior is proven user-visible; currently no import consumer |
| `stores/tags.store.ts`, `ManageTagConnectionsModal.vue`                                 | `features/tags`                                                             |
| old `TagInput.vue`                                                                      | split into `foundation/ui/TokenInput` + domain pickers                      |
| `stores/sshKeys.store.ts`, `SshKeySelector.vue`, `SshKeyManagementModal.vue`            | `features/ssh-keys`                                                         |
| `stores/proxies.store.ts`, `views/ProxiesView.vue`, `AddProxyForm.vue`, `ProxyList.vue` | `features/proxies`                                                          |

## Notification/audit/system overview

| Old source                                                                                                                | Final owner                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `stores/notifications.store.ts`, `NotificationSettings.vue`, `NotificationSettingForm.vue`, `views/NotificationsView.vue` | `features/notifications`                                                  |
| `stores/audit.store.ts`, `views/AuditLogView.vue`                                                                         | `features/audit`                                                          |
| dashboard `/system/status` and `/system/ssh-resources` logic                                                              | `features/system-overview` API/model; dashboard owns polling presentation |

## Preferences/data/appearance

| Old source                                                                       | Final owner                                                                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| generic values from `stores/settings.store.ts`                                   | `features/preferences`                                                                                                      |
| `SystemSettingsSection.vue`, `useSystemSettings.ts`                              | page/settings composition + Preferences                                                                                     |
| Workspace-specific settings fields/composables                                   | `runtimes/workspace/settings` consuming Preferences                                                                         |
| `stores/layout.store.ts`                                                         | layout model persistence split: Workspace layout in `runtimes/workspace/layout`; transport through Preferences/settings API |
| `DataManagementSection.vue`, backup composables                                  | `features/backup`                                                                                                           |
| duplicated `useDataManagement.ts` / `useExportConnections.ts`                    | consolidate or delete duplicate path; one product workflow only                                                             |
| `stores/appearance.store.ts`                                                     | `features/appearance`                                                                                                       |
| `StyleCustomizer*.vue`, `AppearanceSection.vue`, appearance settings composables | `features/appearance`                                                                                                       |
| `features/appearance/config/default-themes.ts`                                   | `features/appearance/config`                                                                                                |
| `features/appearance/config/iterm-themes.ts`                                     | delete if still unused after rewrite                                                                                        |

## Quick Commands and Command History

| Old source                                                          | Final owner                                                                | Decoupling rule                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| `stores/quickCommands.store.ts`, `stores/quickCommandTags.store.ts` | `features/quick-commands`                                                  | no notification/session/workspace store imports |
| `views/QuickCommandsView.vue`, `AddEditQuickCommandForm.vue`        | `features/quick-commands`                                                  | emit command intent; runtime executes it        |
| `QuickCommandsModal.vue`                                            | Workspace wrapper or Quick Commands reusable surface depending final props |
| `stores/commandHistory.store.ts`, `views/CommandHistoryView.vue`    | `features/command-history`                                                 | emit command intent; runtime executes it        |
| `CommandHistoryMenu.vue`                                            | delete if still unused                                                     |

## Terminal

| Old source                                    | Final owner                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `Terminal.vue`                                | `features/terminal/components`                                              |
| `VirtualKeyboard.vue`                         | `features/terminal/components`                                              |
| `useSshTerminal.ts`                           | split into Terminal state/controller + runtime `TerminalChannel` adapter    |
| `terminalModifiers.ts`, `terminalSnapshot.ts` | `features/terminal` helpers                                                 |
| xterm imports/addons                          | `features/terminal` only                                                    |
| NXTM framing                                  | temporary `runtimes/workspace/protocol/legacy-wire`, then protocol decision |

## Filesystem and navigation

| Old source                                                   | Final owner                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `FileManager.vue`                                            | `features/filesystem/components` rewritten into list/controller + smaller UI pieces          |
| `FileManagerActionModal.vue`                                 | `features/filesystem`                                                                        |
| `FileManagerContextMenu.vue`, `useFileManagerContextMenu.ts` | `features/filesystem`; remove current direct cycle                                           |
| selection/keyboard/drag-drop composables                     | `features/filesystem/composables` unless generic mechanic moves to Foundation                |
| `useSftpActions.ts`                                          | split into `FilesystemChannel` interface + Workspace adapter; legacy wire private to runtime |
| `types/sftp.types.ts`                                        | split into clean Filesystem/File Editor models; no legacy `attrs/filename` shape             |
| `favoritePaths.store.ts`, Favorite components                | `features/filesystem/favorites`                                                              |
| `pathHistory.store.ts`, `PathHistoryDropdown.vue`            | `features/filesystem/history`                                                                |
| HTTP download ticket logic                                   | filesystem/download client boundary, not Workspace store                                     |

## File Editor

| Old source                                                               | Final owner                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `fileEditor.store.ts`                                                    | `features/file-editor`                                                     |
| `FileEditorContainer.vue`, `FileEditorOverlay.vue`, `FileEditorTabs.vue` | `features/file-editor`                                                     |
| `MonacoEditor.vue`, workers                                              | `features/file-editor` + top-level worker entries if required by bundler   |
| `CodeMirrorMobileEditor.vue`                                             | `features/file-editor`                                                     |
| `useFileEditor.ts`                                                       | delete old duplicate helper; rewrite only needed language/encoding helpers |
| old editor fields inside SessionState                                    | remove; editor state owned entirely by File Editor                         |

## File Preview

| Old source                             | Final owner                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| all `components/preview/*`             | `features/file-preview/components`                                                |
| all `composables/file-preview/*`       | `features/file-preview`                                                           |
| PDF.js/docx/xlsx/Markdown sanitation   | `features/file-preview` only                                                      |
| preview state stored in editor/session | expose through File Preview/File Editor owned state, never Workspace session blob |

## Transfers / upload / archive / progress

| Old source                                             | Final owner                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `progressCenter.store.ts`                              | `features/transfers`                                             |
| `useFileUploader.ts`                                   | `features/transfers` controller + `TransferChannel`/upload port  |
| transfer/archive portions of `useSftpActions.ts`       | `features/transfers` capability, Workspace adapter               |
| `FileUploadPopup.vue`, `FileTransferPopup.vue`         | `features/transfers`                                             |
| `ArchiveProgressPopup.vue`, `ArchivePasswordModal.vue` | `features/transfers`                                             |
| `UploadConflictModal.vue`                              | `features/transfers`                                             |
| `ProgressDisplayModal.vue`                             | `features/transfers`                                             |
| `SendFilesModal.vue`                                   | `features/transfers` cross-session workflow                      |
| NXUP framing                                           | temporary runtime legacy-wire only, then final protocol decision |

## Status and Docker

| Old source                                                                               | Final owner                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `StatusMonitor.vue`, `StatusCharts.vue`, `StatusMonitorModal.vue`, `useStatusMonitor.ts` | `features/status-monitor`                      |
| status manager fields in SessionState                                                    | remove; runtime adapter provides StatusChannel |
| `DockerManager.vue`, `useDockerManager.ts`                                               | `features/docker`                              |
| Docker manager fields in SessionState                                                    | remove; runtime adapter provides DockerChannel |

## Remote Desktop

| Old source                                   | Final owner                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `RemoteDesktopModal.vue`, `VncModal.vue`     | `features/remote-desktop`                                                              |
| `foundation/interaction/remoteTouchInput.ts` | keep generic touch math in Foundation; Guacamole-specific adapter stays Remote Desktop |
| remote modal state in SessionState           | remove; Remote Desktop owns window/view state                                          |
| token HTTP + proxy WebSocket                 | Remote Desktop API/transport boundary                                                  |

## SSH Suspend

| Old source                            | Final owner                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `sshSuspendActions.ts`                | split into `features/ssh-suspend` state/use cases + Workspace protocol adapter |
| `SuspendedSshSessionsView.vue`, modal | `features/ssh-suspend` or Workspace wrapper around reusable feature surface    |
| suspend refs in SessionState          | remove                                                                         |

## Workspace runtime

| Old source                                                             | Final owner                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `session.store.ts`, `session/state.ts`, session lifecycle subset       | `runtimes/workspace/session` only for runtime registry/tab identity/reconnect   |
| `useWebSocketConnection.ts`                                            | `runtimes/workspace/protocol` over raw `client/websocket`                       |
| `workspaceEvents.ts`                                                   | replace with typed runtime composition/ports; do not restore global untyped bus |
| `WorkspaceView.vue`                                                    | `runtimes/workspace/views`                                                      |
| `LayoutRenderer.vue`, `LayoutConfigurator.vue`, `LayoutNodeEditor.vue` | `runtimes/workspace/layout`                                                     |
| `TerminalTabBar.vue`                                                   | `runtimes/workspace/session-tabs`                                               |
| `CommandInputBar.vue`                                                  | `runtimes/workspace/command-bar`                                                |
| `FocusSwitcherConfigurator.vue`                                        | `runtimes/workspace/focus` using Shared Focus registry                          |
| `PaneTitleBar.vue`                                                     | delete if still unused; otherwise Workspace layout primitive                    |

Workspace runtime may depend on feature public surfaces. No capability feature may import Workspace internals.

## Agent runtime

There is no old file mapping. `runtimes/agent` is new implementation only. It can consume the same feature ports/public components that Workspace consumes, but must have its own protocol/session/adapters.

## Shared/Foundation candidates

| Old source                                                                                                    | Final owner                                                                 |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `common/ConfirmDialog.vue`, `common/AlertDialog.vue`, UI notifications                                        | `shared/feedback` using Foundation modal/button                             |
| `useConfirmDialog.ts`, `useAlertDialog.ts`                                                                    | `shared/feedback`                                                           |
| `focusSwitcher.store.ts` generic target registry part                                                         | `shared/focus`; Workspace-specific configuration remains runtime            |
| `useDeviceDetection.ts`                                                                                       | `foundation/browser`                                                        |
| `useDraggablePosition`, `useResizable`, `useResizeHandle`, `useSidebarResize`, `wheelScale` generic mechanics | `foundation/interaction` after stripping product state/persistence          |
| `latestValueSaver.ts`                                                                                         | `foundation/async`                                                          |
| `OverlayPanel.vue`                                                                                            | `foundation/ui`                                                             |
| `TabBarContextMenu.vue`                                                                                       | generic base/shared menu only if editor + runtime tabs still share behavior |

## Candidate removals to verify during rewrite

Static/dynamic import analysis and manual search identify these as currently unconsumed or duplicate candidates. They are **not** copied into the new skeleton by default:

- `components/CommandHistoryMenu.vue`;
- `components/ConnectionList.vue`;
- `components/PaneTitleBar.vue`;
- `composables/settings/useAboutSection.ts`;
- duplicated/obsolete `useDataManagement.ts` and `useExportConnections.ts` paths after one backup/export workflow is designed;
- `composables/useFileEditor.ts` after File Editor rewrite;
- `features/appearance/config/iterm-themes.ts` if no user-visible behavior requires it;
- `views/TagsView.vue` because the route is currently commented out;
- global Element Plus registration/dependency because no `el-*` usage exists in the old source.

Every removal is validated against real user-visible E2E/behavior, not against internal implementation tests.
