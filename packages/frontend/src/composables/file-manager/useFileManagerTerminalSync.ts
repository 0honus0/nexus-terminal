/**
 * 文件管理器终端路径同步逻辑
 * 从 FileManager.vue 提取，负责终端路径同步命令与静默执行
 */

import { ref, type ComputedRef } from 'vue';
import type { useI18n } from 'vue-i18n';
import type { SftpManagerInstance, WebSocketDependencies } from '../../composables/useSftpActions';
import type { WebSocketMessage, MessagePayload } from '../../types/websocket.types';
import type { useSessionStore } from '../../stores/session.store';
import type { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import { SILENT_PWD_PREFIX, parsePathFromSilentOutput } from './fileManagerTerminalPathUtils';

type SessionStore = ReturnType<typeof useSessionStore>;
type UiNotificationsStore = ReturnType<typeof useUiNotificationsStore>;

type SilentExecPayload = {
  output?: string;
  error?: string;
};

const generateRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export interface UseFileManagerTerminalSyncOptions {
  /** SFTP 管理器实例（响应式） */
  currentSftpManager: ComputedRef<SftpManagerInstance | null>;
  /** WebSocket 依赖项 */
  wsDeps: WebSocketDependencies;
  /** 会话 ID */
  sessionId: string;
  /** 实例 ID */
  instanceId: string;
  /** 国际化翻译函数 */
  t: ReturnType<typeof useI18n>['t'];
  /** UI 通知 Store */
  uiNotificationsStore: UiNotificationsStore;
  /** 会话 Store */
  sessionStore: SessionStore;
}

export function useFileManagerTerminalSync(options: UseFileManagerTerminalSyncOptions) {
  const {
    currentSftpManager,
    wsDeps,
    sessionId,
    instanceId,
    t,
    uiNotificationsStore,
    sessionStore,
  } = options;

  const logPrefix = `[FileManager ${sessionId}-${instanceId}]`;

  const isSyncingPathFromTerminal = ref(false);
  let unregisterSilentExecResult: (() => void) | null = null;
  let unregisterSilentExecError: (() => void) | null = null;
  let unregisterSilentExecDisconnect: (() => void) | null = null;
  let unregisterSilentExecClosed: (() => void) | null = null;
  let unregisterSilentExecSocketError: (() => void) | null = null;
  let silentExecTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** 清理所有静默执行相关的监听器和定时器 */
  const cleanupSilentExecRequest = () => {
    unregisterSilentExecResult?.();
    unregisterSilentExecResult = null;
    unregisterSilentExecError?.();
    unregisterSilentExecError = null;
    unregisterSilentExecDisconnect?.();
    unregisterSilentExecDisconnect = null;
    unregisterSilentExecClosed?.();
    unregisterSilentExecClosed = null;
    unregisterSilentExecSocketError?.();
    unregisterSilentExecSocketError = null;
    if (silentExecTimeoutId) {
      clearTimeout(silentExecTimeoutId);
      silentExecTimeoutId = null;
    }
  };

  /** 发送 cd 命令到当前终端 */
  const sendCdCommandToTerminal = () => {
    const manager = currentSftpManager.value;
    if (!manager || !wsDeps.isConnected.value) {
      console.warn(`${logPrefix} Cannot send CD command: SFTP manager not ready or not connected.`);
      return;
    }
    const currentPath = manager.currentPath.value;
    if (!currentPath) {
      console.warn(`${logPrefix} Cannot send CD command: Current path is empty.`);
      return;
    }

    const escapedPath = `"${currentPath}"`;
    const command = `cd ${escapedPath}\n`;

    console.info(`${logPrefix} Sending command to terminal: ${command.trim()}`);
    try {
      const activeSession = sessionStore.activeSession;
      if (!activeSession) {
        console.error(`${logPrefix} Failed to send command: No active session found.`);
        return;
      }
      if (!activeSession.terminalManager) {
        console.error(
          `${logPrefix} Failed to send command: Terminal manager not found for active session.`
        );
        return;
      }
      activeSession.terminalManager.sendData(command);
    } catch (error) {
      console.error(`${logPrefix} Failed to send command to terminal:`, error);
    }
  };

  /** 同步当前路径到终端工作目录（通过静默执行 pwd 命令） */
  const syncCurrentPathToTerminalDirectory = () => {
    const manager = currentSftpManager.value;
    if (!manager || !wsDeps.isConnected.value || isSyncingPathFromTerminal.value) {
      return;
    }

    const requestId = generateRequestId();
    const { sendMessage, onMessage } = wsDeps;
    const posixPwdCommand = `printf '${SILENT_PWD_PREFIX}%s\\n' "$(pwd 2>/dev/null || /bin/pwd 2>/dev/null || command pwd 2>/dev/null || printf '%s' "$PWD" 2>/dev/null || echo "$PWD" 2>/dev/null)"`;
    const commandsByShell = {
      posix: posixPwdCommand,
      fish: `printf '${SILENT_PWD_PREFIX}%s\\n' (pwd)`,
      powershell: `Write-Output ('${SILENT_PWD_PREFIX}' + (Get-Location).Path)`,
      cmd: `echo ${SILENT_PWD_PREFIX}%cd%`,
      default: posixPwdCommand,
    };

    isSyncingPathFromTerminal.value = true;
    cleanupSilentExecRequest();

    const finishWithError = (message: string) => {
      cleanupSilentExecRequest();
      isSyncingPathFromTerminal.value = false;
      uiNotificationsStore.showError(message);
    };

    const finishSilentlyOnDisconnect = () => {
      cleanupSilentExecRequest();
      isSyncingPathFromTerminal.value = false;
    };

    unregisterSilentExecResult = onMessage(
      'ssh:exec_silent:result',
      (payload: MessagePayload, message: WebSocketMessage) => {
        const p = payload as unknown as SilentExecPayload;
        if (message.requestId !== requestId) return;

        cleanupSilentExecRequest();
        isSyncingPathFromTerminal.value = false;

        const output = typeof p?.output === 'string' ? p.output : '';
        const path = parsePathFromSilentOutput(output);

        if (!path) {
          uiNotificationsStore.showError(
            t('fileManager.errors.pathReadFailed', '读取终端路径失败')
          );
          return;
        }

        currentSftpManager.value?.loadDirectory(path);
      }
    );

    unregisterSilentExecError = onMessage(
      'ssh:exec_silent:error',
      (payload: MessagePayload, message: WebSocketMessage) => {
        const p = payload as unknown as SilentExecPayload;
        if (message.requestId !== requestId) return;
        const errorMessage =
          typeof p?.error === 'string'
            ? p.error
            : t('fileManager.errors.pathReadFailed', '读取终端路径失败');
        finishWithError(errorMessage);
      }
    );

    unregisterSilentExecDisconnect = onMessage('ssh:disconnected', () => {
      finishSilentlyOnDisconnect();
    });

    unregisterSilentExecClosed = onMessage('internal:closed', () => {
      finishSilentlyOnDisconnect();
    });

    unregisterSilentExecSocketError = onMessage('internal:error', () => {
      finishSilentlyOnDisconnect();
    });

    silentExecTimeoutId = setTimeout(() => {
      finishWithError(t('fileManager.errors.pathReadTimeout', '读取终端路径超时'));
    }, 6000);

    sendMessage({
      type: 'ssh:exec_silent',
      requestId,
      payload: {
        commandsByShell,
        timeoutMs: 5000,
        successCriteria: 'absolute_path',
        suppressTerminalPrompt: true,
      },
    });
  };

  return {
    isSyncingPathFromTerminal,
    sendCdCommandToTerminal,
    syncCurrentPathToTerminalDirectory,
    cleanupSilentExecRequest,
  };
}
