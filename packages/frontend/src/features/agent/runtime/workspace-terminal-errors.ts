import type { Composer } from 'vue-i18n';

const WORKSPACE_TERMINAL_ERROR_KEYS = {
  WORKSPACE_TERMINAL_PROTOCOL_INVALID: 'agent.workspaceRuntime.terminalError.protocolInvalid',
  WORKSPACE_TERMINAL_ATTACH_FAILED: 'agent.workspaceRuntime.terminalError.attachFailed',
  WORKSPACE_TERMINAL_RECONNECT_EXHAUSTED: 'agent.workspaceRuntime.terminalError.reconnectExhausted',
  WORKSPACE_TERMINAL_INPUT_QUEUE_FULL: 'agent.workspaceRuntime.terminalError.inputQueueFull',
  WORKSPACE_TERMINAL_SESSION_CHANGED: 'agent.workspaceRuntime.terminalError.sessionChanged',
} as const;

export const formatWorkspaceTerminalError = (t: Composer['t'], code: string): string => {
  const key = (WORKSPACE_TERMINAL_ERROR_KEYS as Readonly<Record<string, string>>)[code];
  return key ? t(key) : t('agent.workspaceRuntime.terminalError.generic');
};
