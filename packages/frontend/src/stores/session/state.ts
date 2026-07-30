// packages/frontend/src/stores/session/state.ts

import { ref, shallowRef } from 'vue';
import type { SessionState } from './types';
// 修正导入路径
import type { ConnectionInfo } from '../connections.store'; // 路径: packages/frontend/src/stores/connections.store.ts
import type { SuspendedSshSession } from '../../types/ssh-suspend.types'; // 路径: packages/frontend/src/types/ssh-suspend.types.ts

// 使用 shallowRef 避免深度响应性问题，保留管理器实例内部的响应性
export const sessions = shallowRef<Map<string, SessionState>>(new Map());
export const activeSessionId = ref<string | null>(null);
const sessionIdAliases = new Map<string, string>();
const sessionIdAliasVersion = ref(0);

export const registerSessionIdAlias = (oldSessionId: string, newSessionId: string) => {
  if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) return;
  sessionIdAliases.forEach((target, alias) => {
    if (target === oldSessionId) sessionIdAliases.set(alias, newSessionId);
  });
  sessionIdAliases.set(oldSessionId, newSessionId);
  sessionIdAliasVersion.value++;
};

export const resolveSessionId = (sessionId: string): string => {
  sessionIdAliasVersion.value; // 让 computed/watch 能感知别名更新
  let resolved = sessionId;
  const visited = new Set<string>();
  while (sessionIdAliases.has(resolved) && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = sessionIdAliases.get(resolved)!;
  }
  return resolved;
};

export const clearSessionIdAliases = (sessionId: string) => {
  let changed = false;
  sessionIdAliases.forEach((target, alias) => {
    if (alias === sessionId || target === sessionId || resolveSessionId(alias) === sessionId) {
      sessionIdAliases.delete(alias);
      changed = true;
    }
  });
  if (changed) sessionIdAliasVersion.value++;
};

// --- RDP Modal State ---
export const isRdpModalOpen = ref(false);
export const rdpConnectionInfo = ref<ConnectionInfo | null>(null);

// --- VNC Modal State ---
export const isVncModalOpen = ref(false);
export const vncConnectionInfo = ref<ConnectionInfo | null>(null);

// --- SSH Suspend Mode State ---
export const suspendedSshSessions = ref<SuspendedSshSession[]>([]);
export const isLoadingSuspendedSessions = ref<boolean>(false);
