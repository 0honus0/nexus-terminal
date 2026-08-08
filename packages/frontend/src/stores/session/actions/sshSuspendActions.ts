
import { v4 as uuidv4 } from 'uuid';
import { sessions, suspendedSshSessions, isLoadingSuspendedSessions, activeSessionId, resolveSessionId } from '../state';
import type {
  MessagePayload,
  WebSocketMessage,
  SshMarkForSuspendReqMessage,
  SshUnmarkForSuspendReqMessage, 
  SshSuspendResumeReqMessage,
  SshSuspendTerminateReqMessage,
  SshSuspendRemoveEntryReqMessage,
  
  
  SshMarkedForSuspendAckPayload,
  SshUnmarkedForSuspendAckPayload, 
  SshSuspendListResponsePayload,
  SshSuspendResumedNotifPayload,
  SshOutputCachedChunkPayload,
  SshSuspendTerminatedRespPayload,
  SshSuspendEntryRemovedRespPayload,
  
  SshSuspendAutoTerminatedNotifPayload,
} from '../../../types/websocket.types'; 
import type { WsManagerInstance, SessionState } from '../types'; 
import { activateSession as activateSessionAction, openNewSession, closeSession } from './sessionActions';
import { useConnectionsStore } from '../../connections.store'; 
import { useUiNotificationsStore } from '../../uiNotifications.store'; 
import type { SuspendedSshSession } from '../../../types/ssh-suspend.types'; 
import i18n from '../../../i18n'; 
import type { ComposerTranslation } from 'vue-i18n'; 
import apiClient from '../../../utils/apiClient'; 
import { isAxiosError } from 'axios';
import { serializeTerminalSnapshot } from '../../../utils/terminalSnapshot';

const t: ComposerTranslation = i18n.global.t; 
const MAX_PENDING_RESUME_OUTPUT_BYTES = 1024 * 1024;
const terminalOutputEncoder = new TextEncoder();
const FOREGROUND_RECOVERY_ATTEMPTS = 10;
const FOREGROUND_RECOVERY_DELAY_MS = 400;
// 后端单个终端缓存帧 ACK 最长等待 120s。前端恢复事务必须晚于这个窗口，
// 否则慢网络下会在后端仍正常等待 ACK 时误判失败并主动关闭恢复连接。
const RESUME_COMPLETION_TIMEOUT_MS = 135_000;

type ResumeContext = {
  replaceSessionId?: string;
  restoreActiveSessionId?: string;
  activateOnSuccess: boolean;
  notifyOnSuccess: boolean;
  notifyOnError: boolean;
  complete: () => void;
};

const pendingResumeContexts = new Map<string, ResumeContext>();
const silentSuspendMarkSessionIds = new Set<string>();
let foregroundRecoveryPromise: Promise<void> | null = null;

const wait = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

const getMarkedActiveSessions = (): SuspendedSshSession[] => Array.from(sessions.value.values())
  .filter(session => session.isMarkedForSuspend)
  .map(session => ({
    suspendSessionId: session.sessionId,
    originalSessionId: session.sessionId,
    connectionName: session.connectionName,
    connectionId: session.connectionId,
    suspendStartTime: session.suspendMarkedAt || new Date(session.createdAt).toISOString(),
    backendSshStatus: 'marked_active',
  }));

const mergeMarkedActiveSessions = (items: SuspendedSshSession[]): SuspendedSshSession[] => {
  const backendItems = items.filter(session => session.backendSshStatus !== 'marked_active');
  const backendSessionIds = new Set(backendItems.map(session => session.suspendSessionId));
  return [
    ...backendItems,
    ...getMarkedActiveSessions().filter(session => !backendSessionIds.has(session.suspendSessionId)),
  ];
};

// 辅助函数：获取一个可用的 WebSocket 管理器
// 优先使用当前激活的会话，或者任意一个已连接的 SSH 会话
// 注意：此函数主要用于那些仍然需要 WebSocket 的操作 (如 resume, terminate)
const getActiveWsManager = (): WsManagerInstance | null => {

  const firstSessionKey = sessions.value.size > 0 ? sessions.value.keys().next().value : null;
  // console.log(`[getActiveWsManager] 尝试使用第一个会话 Key (如果存在): ${firstSessionKey}`);

  if (firstSessionKey) {
    const session = sessions.value.get(firstSessionKey);
    // console.log(`[getActiveWsManager]   第一个会话 (ID: ${firstSessionKey}): WS Manager 存在: ${!!session?.wsManager}, WS 已连接: ${session?.wsManager?.isConnected?.value}`);
    if (session && session.wsManager && session.wsManager.isConnected.value) {
      // console.log(`[getActiveWsManager] 使用第一个会话 (ID: ${firstSessionKey}) 的 WebSocket。`);
      return session.wsManager;
    }
  }

  // console.log('[getActiveWsManager] 第一个会话的 WebSocket 不可用或不存在，开始遍历所有会话...');
  for (const [sessionId, session] of sessions.value) {
    // console.log(`[getActiveWsManager]   遍历中 - 检查会话 ID: ${sessionId}, WS Manager 存在: ${!!session.wsManager}, WS 已连接: ${session.wsManager?.isConnected?.value}`);
    if (session.wsManager && session.wsManager.isConnected.value) {
      // console.log(`[getActiveWsManager]   遍历成功，使用会话 (ID: ${sessionId}) 的 WebSocket。`);
      return session.wsManager;
    }
  }

  // console.warn('[getActiveWsManager] 遍历结束，仍未找到可用的 WebSocket 连接来发送 SSH 挂起相关请求。');
  return null;
};


/**
 * 请求启动 SSH 会话挂起
 * @param sessionId 要挂起的活动会话 ID
 */
export const requestStartSshSuspend = (
  sessionId: string,
  options?: { silent?: boolean; markedAt?: string },
): void => {
  const session = sessions.value.get(sessionId);
  if (session && session.wsManager) {
    if (!session.wsManager.isConnected.value) {
      console.warn(`[${t('term.sshSuspend')}] WebSocket 未连接，无法请求标记挂起 (会话 ID: ${sessionId})。`);
      useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.wsNotConnectedError') });
      return;
    }

    let initialBuffer = '';
    if (session.terminalManager && session.terminalManager.terminalInstance && session.terminalManager.terminalInstance.value) {
      const term = session.terminalManager.terminalInstance.value;
      initialBuffer = serializeTerminalSnapshot(term) || '';

    } else {
      console.warn(`[${t('term.sshSuspend')}] 未能获取会话 ${sessionId} 的终端实例以提取初始缓冲区。`);
    }

    const message: SshMarkForSuspendReqMessage = {
      type: 'SSH_MARK_FOR_SUSPEND',
      payload: { sessionId, initialBuffer: initialBuffer || undefined }, // +++ 将 initialBuffer 添加到 payload +++
    };
    // 先更新本地列表，让用户标记后立即能在挂起管理器看到该终端；
    // 后端 ACK 失败时会回滚此状态。
    session.isMarkedForSuspend = true;
    session.suspendMarkedAt = options?.markedAt || session.suspendMarkedAt || new Date().toISOString();
    if (options?.silent) silentSuspendMarkSessionIds.add(sessionId);
    sessions.value = new Map(sessions.value);
    suspendedSshSessions.value = mergeMarkedActiveSessions(suspendedSshSessions.value);
    session.wsManager.sendMessage(message);
    console.log(`[${t('term.sshSuspend')}] 已发送 SSH_MARK_FOR_SUSPEND 请求 (会话 ID: ${sessionId}, 包含初始缓冲区: ${!!initialBuffer})`);
    // 成功提示由后端 ACK 驱动，避免先显示成功、随后又显示失败。

  } else {
    console.warn(`[${t('term.sshSuspend')}] 未找到会话或 WebSocket 管理器 (会话 ID: ${sessionId})，无法请求标记挂起。`);
    useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.sessionNotFoundError') });
  }
};

/**
 * 请求取消标记一个会话为待挂起
 * @param sessionId 要取消标记的活动会话 ID
 */
export const requestUnmarkSshSuspend = (sessionId: string): void => {
  const session = sessions.value.get(sessionId);
  if (session && session.wsManager) {
    if (!session.wsManager.isConnected.value) {
      console.warn(`[${t('term.sshSuspend')}] WebSocket 未连接，无法请求取消标记挂起 (会话 ID: ${sessionId})。`);
      useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.wsNotConnectedError') });
      return;
    }
    if (!session.isMarkedForSuspend) {
      console.warn(`[${t('term.sshSuspend')}] 会话 ${sessionId} 并未被标记为待挂起，无需取消。`);
      // 可以选择不发送请求或发送一个让后端确认的请求
      // 为保持简单，如果前端状态已经是未标记，则不执行操作或仅给用户提示
      useUiNotificationsStore().addNotification({ type: 'info', message: t('sshSuspend.notifications.notMarkedWarning') });
      return;
    }

    const message: SshUnmarkForSuspendReqMessage = {
      type: 'SSH_UNMARK_FOR_SUSPEND',
      payload: { sessionId },
    };
    session.wsManager.sendMessage(message);
    console.log(`[${t('term.sshSuspend')}] 已发送 SSH_UNMARK_FOR_SUSPEND 请求 (会话 ID: ${sessionId})`);
  } else {
    console.warn(`[${t('term.sshSuspend')}] 未找到会话或 WebSocket 管理器 (会话 ID: ${sessionId})，无法请求取消标记挂起。`);
    useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.sessionNotFoundError') });
  }
};

/**
 * 获取挂起的 SSH 会话列表 (通过 HTTP API)
 */
export const fetchSuspendedSshSessions = async (options?: {
  showLoadingIndicator?: boolean;
  notifyOnError?: boolean;
}): Promise<{ ok: boolean; status?: number }> => {
  const shouldShowLoading = options?.showLoadingIndicator ?? true;
  const shouldNotifyOnError = options?.notifyOnError ?? true;

  if (shouldShowLoading) {
    isLoadingSuspendedSessions.value = true;
  }
  try {
    // 假设后端 API 端点为 /api/ssh/suspended-sessions
    // 并且它返回 SuspendedSshSession[] 类型的数据
    const response = await apiClient.get<SuspendedSshSession[]>('ssh-suspend/suspended-sessions');
    suspendedSshSessions.value = mergeMarkedActiveSessions(response.data);
    console.log(`[${t('term.sshSuspend')}] 已获取挂起列表，后端 ${response.data.length} 个、待关闭 ${getMarkedActiveSessions().length} 个。`);
    return { ok: true, status: 200 };
  } catch (error) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP 获取挂起列表失败:`, error);
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (shouldNotifyOnError) {
      const uiNotificationsStore = useUiNotificationsStore();
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.fetchListError', { error: String(error) }),
      });
    }
    // 即使失败，也可能需要清空旧数据或保留旧数据，具体取决于产品需求
    return { ok: false, status };
  } finally {
    if (shouldShowLoading) {
      isLoadingSuspendedSessions.value = false;
    }
  }
};

/**
 * 手机浏览器从后台回到前台时恢复“已标记挂起且 WebSocket 已断开”的 SSH 标签。
 * 后端断开清理和挂起接管是异步的，因此短时间轮询挂起列表，直到能按 originalSessionId
 * 找到对应的 hanging 会话。未标记的普通 SSH 会话完全不走这里，继续使用原有自动重连。
 */
export const recoverMarkedSshSessionsAfterForeground = async (): Promise<void> => {
  if (foregroundRecoveryPromise) return foregroundRecoveryPromise;

  foregroundRecoveryPromise = (async () => {
    // 把当前所有已标记会话纳入一个短暂观察窗口。某些手机浏览器会先派发
    // visibilitychange，再派发被冻结期间积压的 WebSocket close 事件。
    const candidateOriginalIds = new Set(
      Array.from(sessions.value.values())
        .filter(session => session.isMarkedForSuspend)
        .map(session => session.sessionId),
    );
    if (candidateOriginalIds.size === 0) return;

    for (let attempt = 0; attempt < FOREGROUND_RECOVERY_ATTEMPTS && candidateOriginalIds.size > 0; attempt++) {
      const disconnectedIds: string[] = [];
      for (const originalId of Array.from(candidateOriginalIds)) {
        const resolvedOriginalId = resolveSessionId(originalId);
        const oldSession = sessions.value.get(resolvedOriginalId);
        if (!oldSession || !oldSession.isMarkedForSuspend) {
          candidateOriginalIds.delete(originalId);
          continue;
        }
        if (oldSession.wsManager.isConnected.value) {
          // 已在线的待关闭会话无需“恢复”，保持标记即可。
          candidateOriginalIds.delete(originalId);
          continue;
        }
        if (!oldSession.wsManager.isConnected.value && !oldSession.isResuming) {
          disconnectedIds.push(originalId);
        }
      }

      if (disconnectedIds.length > 0) {
        await fetchSuspendedSshSessions({ showLoadingIndicator: false, notifyOnError: false });
      }

      for (const originalId of disconnectedIds) {
        const resolvedOriginalId = resolveSessionId(originalId);
        const oldSession = sessions.value.get(resolvedOriginalId);
        if (!oldSession || oldSession.wsManager.isConnected.value || oldSession.isResuming) continue;

        const suspended = suspendedSshSessions.value.find(item =>
          item.backendSshStatus === 'hanging'
          && item.originalSessionId === resolvedOriginalId,
        );
        if (!suspended) continue;

        oldSession.isResuming = true;
        const shouldActivate = activeSessionId.value === resolvedOriginalId;
        await resumeSshSession(suspended.suspendSessionId, {
          replaceSessionId: resolvedOriginalId,
          activateOnSuccess: shouldActivate,
          notifyOnSuccess: false,
          notifyOnError: false,
        });
        candidateOriginalIds.delete(originalId);
      }

      if (candidateOriginalIds.size > 0) {
        await wait(FOREGROUND_RECOVERY_DELAY_MS);
      }
    }

    const unresolvedDisconnected = Array.from(candidateOriginalIds).filter(originalId => {
      const session = sessions.value.get(resolveSessionId(originalId));
      return !!session?.isMarkedForSuspend && !session.wsManager.isConnected.value && !session.isResuming;
    });
    if (unresolvedDisconnected.length > 0) {
      // 最后一轮同步后再决定是否 fallback，避免 cleanup/takeover 恰好落在轮询边界。
      await fetchSuspendedSshSessions({ showLoadingIndicator: false, notifyOnError: false });

      for (const originalId of unresolvedDisconnected) {
        const resolvedOriginalId = resolveSessionId(originalId);
        const oldSession = sessions.value.get(resolvedOriginalId);
        if (!oldSession || !oldSession.isMarkedForSuspend || oldSession.wsManager.isConnected.value || oldSession.isResuming) continue;

        const hanging = suspendedSshSessions.value.find(item =>
          item.backendSshStatus === 'hanging'
          && item.originalSessionId === resolvedOriginalId,
        );
        if (hanging) {
          oldSession.isResuming = true;
          const shouldActivate = activeSessionId.value === resolvedOriginalId;
          await resumeSshSession(hanging.suspendSessionId, {
            replaceSessionId: resolvedOriginalId,
            activateOnSuccess: shouldActivate,
            notifyOnSuccess: false,
            notifyOnError: false,
          });
          continue;
        }

        // 后端没有可恢复的 hanging 会话，说明 SSH 接管失败或已经由后端断开。
        // 此时继续保留 isMarkedForSuspend 会永久阻止普通 WebSocket 重连；安全降级为新 SSH 重连。
        console.warn(`[${t('term.sshSuspend')}] 未找到会话 ${resolvedOriginalId} 的可恢复挂起连接，清除本地待挂起标记并降级为普通重连。`);
        oldSession.isMarkedForSuspend = false;
        oldSession.suspendMarkedAt = undefined;
        sessions.value = new Map(sessions.value);
        suspendedSshSessions.value = mergeMarkedActiveSessions(suspendedSshSessions.value);

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/`;
        oldSession.wsManager.connect(wsUrl);
      }
    }
  })().finally(() => {
    foregroundRecoveryPromise = null;
  });

  return foregroundRecoveryPromise;
};

/**
 * 请求恢复指定的挂起 SSH 会话。
 * replaceSessionId 用于手机从后台回到前台的自动恢复：新恢复连接成功后替换旧的 disconnected 标签，
 * 而不是把旧标签当成普通 SSH 再连一次。
 */
export const resumeSshSession = async (
  suspendSessionId: string,
  options?: {
    replaceSessionId?: string;
    activateOnSuccess?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnError?: boolean;
  },
): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  const connectionsStore = useConnectionsStore();
  const notifyOnError = options?.notifyOnError ?? true;
  const notifyOnSuccess = options?.notifyOnSuccess ?? true;
  const activateOnSuccess = options?.activateOnSuccess ?? true;

  let sessionToResumeInfo = suspendedSshSessions.value.find(s => s.suspendSessionId === suspendSessionId);
  if (!sessionToResumeInfo) {
    console.error(`[${t('term.sshSuspend')}] 恢复操作失败：在挂起列表中未找到会话 ${suspendSessionId}`);
    if (notifyOnError) {
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorInfoNotFound', { id: suspendSessionId.slice(0, 8) }),
      });
    }
    return;
  }

  if (sessionToResumeInfo.backendSshStatus === 'marked_active') {
    const originalSessionId = resolveSessionId(sessionToResumeInfo.originalSessionId || suspendSessionId);
    const activeMarkedSession = sessions.value.get(originalSessionId);
    if (activeMarkedSession?.wsManager.isConnected.value) {
      // marked_active 表示“当前在线但仍处于待关闭/挂起保护状态”。
      // “恢复”只回到该终端，不等价于取消挂起；只有显式的取消操作才能清除标记。
      activateSessionAction(originalSessionId);
      return;
    }

    // WebSocket 已断开时，后端会把 marked_active 转成真正的 hanging 会话并分配新的 suspendSessionId。
    // 重新拉取列表后按 originalSessionId 找到它，禁止对旧标签做普通 SSH reconnect。
    await fetchSuspendedSshSessions({ showLoadingIndicator: false, notifyOnError });
    sessionToResumeInfo = suspendedSshSessions.value.find(session =>
      session.backendSshStatus === 'hanging'
      && session.originalSessionId === originalSessionId,
    );
    if (!sessionToResumeInfo) return;
    suspendSessionId = sessionToResumeInfo.suspendSessionId;
  }

  if (sessionToResumeInfo.backendSshStatus !== 'hanging') {
    console.warn(`[${t('term.sshSuspend')}] 会话 ${suspendSessionId} 当前状态为 ${sessionToResumeInfo.backendSshStatus}，不能恢复。`);
    return;
  }

  const originalConnectionId = parseInt(sessionToResumeInfo.connectionId, 10);
  if (isNaN(originalConnectionId)) {
    console.error(`[${t('term.sshSuspend')}] 恢复操作失败：无效的原始连接 ID ${sessionToResumeInfo.connectionId}`);
    if (notifyOnError) {
      uiNotificationsStore.addNotification({ type: 'error', message: t('sshSuspend.notifications.resumeErrorConnectionConfigNotFound', { id: sessionToResumeInfo.connectionId }) });
    }
    return;
  }

  const replaceSessionId = options?.replaceSessionId ? resolveSessionId(options.replaceSessionId) : undefined;
  const previousActiveSessionId = activeSessionId.value;
  const newFrontendSessionId = uuidv4();
  let completeResume!: () => void;
  const resumeCompletion = new Promise<void>(resolve => {
    completeResume = resolve;
  });
  pendingResumeContexts.set(newFrontendSessionId, {
    replaceSessionId,
    restoreActiveSessionId: !activateOnSuccess && previousActiveSessionId ? previousActiveSessionId : undefined,
    activateOnSuccess,
    notifyOnSuccess,
    notifyOnError,
    complete: completeResume,
  });

  const resetReplacementState = () => {
    if (!replaceSessionId) return;
    const oldSession = sessions.value.get(replaceSessionId);
    if (oldSession) oldSession.isResuming = false;
  };

  const restorePreviousActiveSession = () => {
    if (activateOnSuccess || !previousActiveSessionId) return;
    const restoreId = resolveSessionId(previousActiveSessionId);
    if (sessions.value.has(restoreId)) activateSessionAction(restoreId);
  };

  const failBeforeResumeRequest = (message: string) => {
    pendingResumeContexts.delete(newFrontendSessionId);
    resetReplacementState();
    if (notifyOnError) {
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorGeneric', { error: message }),
      });
    }
    if (sessions.value.has(newFrontendSessionId)) closeSession(newFrontendSessionId);
    restorePreviousActiveSession();
  };

  try {
    const connectionInfo = connectionsStore.connections.find(c => c.id === originalConnectionId);
    if (!connectionInfo) {
      pendingResumeContexts.delete(newFrontendSessionId);
      resetReplacementState();
      console.error(`[${t('term.sshSuspend')}] 恢复操作失败：在 Connection Store 中未找到原始连接配置 (ID: ${originalConnectionId})。`);
      if (notifyOnError) {
        uiNotificationsStore.addNotification({ type: 'error', message: t('sshSuspend.notifications.resumeErrorConnectionConfigNotFound', { id: String(originalConnectionId) }) });
      }
      return;
    }
    console.log(`[${t('term.sshSuspend')}] 准备恢复会话 ${suspendSessionId} 到前端会话 ${newFrontendSessionId}${replaceSessionId ? `，成功后替换 ${replaceSessionId}` : ''}。`);

    // 恢复期间保持临时恢复会话为 active，确保 Terminal 组件会挂载并及时 ACK
    // SSH_OUTPUT_CACHED_CHUNK；成功后再按 ResumeContext 恢复原来的活动标签。
    openNewSession(connectionInfo, { connectionsStore, t }, newFrontendSessionId);

    const newSessionState = sessions.value.get(newFrontendSessionId);
    if (!newSessionState?.wsManager) {
      console.error(`[${t('term.sshSuspend')}] 调用 openNewSession 后未能获取会话 ${newFrontendSessionId} 或其 wsManager。`);
      failBeforeResumeRequest('无法初始化新会话界面组件');
      return;
    }
    const wsManager = newSessionState.wsManager;

    const MAX_WAIT_ITERATIONS = 25;
    let iterations = 0;
    while (!wsManager.isConnected.value && iterations < MAX_WAIT_ITERATIONS) {
      await wait(200);
      iterations++;
    }

    if (!wsManager.isConnected.value) {
      console.error(`[${t('term.sshSuspend')}] 新创建的会话 ${newFrontendSessionId} 的 WebSocket 未能连接。无法发送恢复请求。`);
      failBeforeResumeRequest('无法连接到服务器以恢复会话');
      return;
    }

    const message: SshSuspendResumeReqMessage = {
      type: 'SSH_SUSPEND_RESUME_REQUEST',
      payload: { suspendSessionId, newFrontendSessionId },
    };
    wsManager.sendMessage(message);
    console.log(`[${t('term.sshSuspend')}] 已通过会话 ${newFrontendSessionId} 请求恢复挂起会话 ${suspendSessionId}。`);

    // 自动恢复可能需要连续处理多个标签；等待本次恢复事务真正结束，避免下一个
    // 临时会话抢走 active 状态，导致当前 Terminal 尚未挂载、缓存帧无法 ACK。
    const completed = await Promise.race([
      resumeCompletion.then(() => true),
      wait(RESUME_COMPLETION_TIMEOUT_MS).then(() => false),
    ]);
    if (!completed && pendingResumeContexts.has(newFrontendSessionId)) {
      pendingResumeContexts.delete(newFrontendSessionId);
      resetReplacementState();
      console.warn(`[${t('term.sshSuspend')}] 恢复会话 ${suspendSessionId} 等待完成超时。`);
      if (notifyOnError) {
        uiNotificationsStore.addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.resumeErrorGeneric', { error: '恢复会话等待超时' }),
        });
      }
      if (sessions.value.has(newFrontendSessionId)) closeSession(newFrontendSessionId);
      restorePreviousActiveSession();
    }
  } catch (error) {
    console.error(`[${t('term.sshSuspend')}] 恢复会话 ${suspendSessionId} 过程中发生顶层错误:`, error);
    pendingResumeContexts.delete(newFrontendSessionId);
    resetReplacementState();
    if (notifyOnError) {
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorGeneric', { error: String(error) }),
      });
    }
    if (sessions.value.has(newFrontendSessionId)) closeSession(newFrontendSessionId);
    restorePreviousActiveSession();
  }
};

/**
 * 请求终止并移除一个活跃的挂起 SSH 会话
 * @param suspendSessionId 要终止并移除的挂起会话 ID
 */
export const terminateAndRemoveSshSession = async (suspendSessionId: string): Promise<void> => {
  console.log(`[${t('term.sshSuspend')}] 请求通过 HTTP API 终止并移除挂起会话 (ID: ${suspendSessionId})`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    // 假设后端 API 返回成功时状态码为 200/204，失败时返回错误信息
    await apiClient.delete(`ssh-suspend/terminate/${suspendSessionId}`);
    console.log(`[${t('term.sshSuspend')}] HTTP API 终止并移除会话 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendTerminatedResp 的逻辑
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.terminatedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 终止并移除会话 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.terminateError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求移除一个已断开的挂起 SSH 会话条目
 * @param suspendSessionId 要移除的挂起会话条目 ID
 */
export const removeSshSessionEntry = async (suspendSessionId: string): Promise<void> => {
  console.log(`[${t('term.sshSuspend')}] 请求通过 HTTP API 移除已断开的挂起条目 (ID: ${suspendSessionId})`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    await apiClient.delete(`ssh-suspend/entry/${suspendSessionId}`);
    console.log(`[${t('term.sshSuspend')}] HTTP API 移除已断开条目 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendEntryRemovedResp 的逻辑
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.entryRemovedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 移除已断开条目 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.entryRemovedError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求编辑挂起 SSH 会话的自定义名称 (通过 HTTP API)
 * @param suspendSessionId 要编辑的挂起会话 ID
 * @param newCustomName 新的自定义名称
 */
export const editSshSessionName = async (suspendSessionId: string, newCustomName: string): Promise<void> => {
  console.log(`[${t('term.sshSuspend')}] 请求通过 HTTP API 编辑挂起会话名称 (ID: ${suspendSessionId}, 新名称: "${newCustomName}")`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    // 假设后端 API 端点为 /api/ssh-suspend/name/:suspendSessionId
    // 并且它接受一个包含 { customName: string } 的 PUT 请求体
    // 并返回包含 { message: string, customName: string } 的成功响应
    const response = await apiClient.put<{ message: string, customName: string }>(
      `ssh-suspend/name/${suspendSessionId}`,
      { customName: newCustomName }
    );

    console.log(`[${t('term.sshSuspend')}] HTTP API 编辑名称 ${suspendSessionId} 成功:`, response.data);

    // 更新前端状态
    const session = suspendedSshSessions.value.find(s => s.suspendSessionId === suspendSessionId);
    if (session) {
      session.customSuspendName = response.data.customName; // 使用后端返回的名称确保一致性
      uiNotificationsStore.addNotification({
        type: 'success',
        message: t('sshSuspend.notifications.nameEditedSuccess', { name: response.data.customName }),
      });
    } else {
      // 如果会话在前端列表中找不到了（理论上不应该发生，因为是先找到再编辑的）
      // 也可以选择重新获取列表
      fetchSuspendedSshSessions();
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 编辑名称 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.nameEditedError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求导出指定挂起 SSH 会话的日志
 * @param suspendSessionId 要导出日志的挂起会话 ID
 */
export const exportSshSessionLog = async (suspendSessionId: string): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 请求导出挂起会话日志 (ID: ${suspendSessionId})`);

  try {
    // API 端点为 /api/v1/ssh-suspend/log/:suspendSessionId
    // apiClient.get会自动处理Blob响应类型，并尝试触发下载
    // 我们需要获取建议的文件名，后端会在 Content-Disposition 头中提供
    const response = await apiClient.get<Blob>(`ssh-suspend/log/${suspendSessionId}`, {
      responseType: 'blob', // 重要：期望响应为 Blob
      // 我们可以传递一个 onDownloadProgress 回调（如果 apiClient 支持的话）
    });

    // 从 Content-Disposition 获取文件名
    const contentDisposition = response.headers['content-disposition'];
    let filename = `ssh_log_${suspendSessionId}.log`; // 默认文件名
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch && filenameMatch.length > 1) {
        filename = filenameMatch[1];
      }
    }

    // 创建一个下载链接并点击它
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename); // 设置下载文件名
    document.body.appendChild(link);
    link.click();

    // 清理
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);

    uiNotificationsStore.addNotification({
      type: 'success',
      message: t('sshSuspend.notifications.logExportSuccess', { name: filename }),
    });
    console.log(`[${t('term.sshSuspend')}] 挂起会话日志 ${filename} (ID: ${suspendSessionId}) 已开始下载。`);

  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 导出挂起会话日志 ${suspendSessionId} 失败:`, error);
    let errorMessage = t('term.unknownError');
    if (error.response && error.response.data) {
      // 如果响应是 Blob 但我们期望 JSON 错误信息，需要特殊处理
      // 假设错误时后端会返回 JSON
      if (error.response.data instanceof Blob && error.response.headers['content-type']?.includes('application/json')) {
        try {
          const errorJson = JSON.parse(await error.response.data.text());
          errorMessage = errorJson.message || errorMessage;
        } catch (e) {
          // Blob 不是有效的 JSON，使用通用错误
        }
      } else if (typeof error.response.data === 'object') {
        errorMessage = error.response.data.message || error.message;
      } else {
        errorMessage = error.message;
      }
    } else {
      errorMessage = error.message || String(error);
    }
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.logExportError', { error: errorMessage }),
    });
  }
};

// --- S2C Message Handlers ---

const handleSshMarkedForSuspendAck = (payload: SshMarkedForSuspendAckPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_MARKED_FOR_SUSPEND_ACK:`, payload);
  const silentMark = silentSuspendMarkSessionIds.delete(payload.sessionId);
  if (payload.success) {
    if (!silentMark) {
      uiNotificationsStore.addNotification({
        type: 'success',
        message: t('sshSuspend.notifications.markedForSuspendSuccess', { id: payload.sessionId.slice(0,8) }),
      });
    }
    const session = sessions.value.get(payload.sessionId);
    if (session) {
      session.isMarkedForSuspend = true; // 假设 SessionState 有此字段
      session.suspendMarkedAt ||= new Date().toISOString();
      sessions.value = new Map(sessions.value); // 强制更新 Map
    }
    suspendedSshSessions.value = mergeMarkedActiveSessions(suspendedSshSessions.value);
    void fetchSuspendedSshSessions({ showLoadingIndicator: false, notifyOnError: false });

  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.markForSuspendError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 标记会话 ${payload.sessionId} 失败: ${payload.error}`);
    const session = sessions.value.get(payload.sessionId);
    if (session) {
      session.isMarkedForSuspend = false; // 确保标记被清除
      session.suspendMarkedAt = undefined;
      sessions.value = new Map(sessions.value); // 强制更新 Map
    }
    suspendedSshSessions.value = mergeMarkedActiveSessions(suspendedSshSessions.value);
  }
};

const handleSshUnmarkedForSuspendAck = (payload: SshUnmarkedForSuspendAckPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_UNMARKED_FOR_SUSPEND_ACK:`, payload);
  const session = sessions.value.get(payload.sessionId);

  if (payload.success) {
    if (session) {
      session.isMarkedForSuspend = false;
      session.suspendMarkedAt = undefined;
      sessions.value = new Map(sessions.value); // 强制更新 Map
    }
    suspendedSshSessions.value = mergeMarkedActiveSessions(suspendedSshSessions.value);
    void fetchSuspendedSshSessions({ showLoadingIndicator: false, notifyOnError: false });
    uiNotificationsStore.addNotification({
      type: 'success',
      message: t('sshSuspend.notifications.unmarkedSuccess', { id: payload.sessionId.slice(0,8) }),
    });
  } else {
    // 即便后端失败，如果前端之前是标记状态，也最好保持一致或提示用户检查
    // 但通常后端失败意味着前端状态可能与后端不一致，提示错误让用户知晓
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.unmarkError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 取消标记会话 ${payload.sessionId} 失败: ${payload.error}`);
    // 此处不自动回滚前端的 isMarkedForSuspend 状态，因为后端是权威源。
    // 如果后端说操作失败，那么会话可能仍然被后端认为是标记的（尽管这不应该发生，因为后端会先清除标记）。
  }
};

const handleSshSuspendListResponse = (payload: SshSuspendListResponsePayload): void => {
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_LIST_RESPONSE，数量: ${payload.suspendSessions.length}`);
  suspendedSshSessions.value = mergeMarkedActiveSessions(payload.suspendSessions);
  isLoadingSuspendedSessions.value = false;
};

const handleSshSuspendResumedNotif = async (payload: SshSuspendResumedNotifPayload): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  const resumeContext = pendingResumeContexts.get(payload.newFrontendSessionId);
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_RESUMED_NOTIF:`, payload);

  const resetReplacementState = () => {
    if (!resumeContext?.replaceSessionId) return;
    const oldSessionId = resolveSessionId(resumeContext.replaceSessionId);
    const oldSession = sessions.value.get(oldSessionId);
    if (oldSession) oldSession.isResuming = false;
  };

  const restoreContextActiveSession = () => {
    if (!resumeContext?.restoreActiveSessionId) return;
    const restoreId = resolveSessionId(resumeContext.restoreActiveSessionId);
    if (sessions.value.has(restoreId)) activateSessionAction(restoreId);
  };

  if (payload.success) {
    const suspendedSession = suspendedSshSessions.value.find(s => s.suspendSessionId === payload.suspendSessionId);
    if (!suspendedSession) {
      console.warn(`[${t('term.sshSuspend')}] 处理 SSH_SUSPEND_RESUMED_NOTIF 时：在挂起列表中未找到会话 ${payload.suspendSessionId} 的详细信息。`);
    }

    try {
      const sessionToUpdate = sessions.value.get(payload.newFrontendSessionId) as SessionState | undefined;
      if (!sessionToUpdate?.wsManager) {
        const reason = !sessionToUpdate ? '无法找到已初始化的恢复会话界面组件。' : '恢复会话状态不完整。';
        console.error(`[${t('term.sshSuspend')}] ${reason} ID: ${payload.newFrontendSessionId}`);
        resetReplacementState();
        restoreContextActiveSession();
        if (resumeContext?.notifyOnError ?? true) {
          uiNotificationsStore.addNotification({
            type: 'error',
            message: t('sshSuspend.notifications.resumeErrorGeneric', { error: reason }),
          });
        }
        return;
      }

      // 收到成功通知时，后端已经完成缓存回放、ACK 和恢复事务提交。
      sessionToUpdate.isResuming = false;
      console.log(`[${t('term.sshSuspend')}] 会话 ${payload.newFrontendSessionId} 已恢复。`);

      if (resumeContext?.activateOnSuccess ?? true) {
        activateSessionAction(payload.newFrontendSessionId);
      }

      // 手机后台恢复成功后，移除已被后端接管的旧 disconnected 标签。
      // 新会话已经回放了挂起日志，所以不会丢终端内容。
      if (resumeContext?.replaceSessionId) {
        const oldSessionId = resolveSessionId(resumeContext.replaceSessionId);
        if (oldSessionId !== payload.newFrontendSessionId && sessions.value.has(oldSessionId)) {
          closeSession(oldSessionId);
        }
      }

      // “挂起”是一个持续状态：恢复只是把 SSH 重新接回当前浏览器，不代表取消挂起。
      // 自动重新标记恢复后的活动会话，使挂起列表继续显示“待关闭”；只有用户手动取消才移除。
      requestStartSshSuspend(payload.newFrontendSessionId, {
        silent: true,
        markedAt: suspendedSession?.suspendStartTime,
      });

      if (!(resumeContext?.activateOnSuccess ?? true)) {
        restoreContextActiveSession();
      }

      if (resumeContext?.notifyOnSuccess ?? true) {
        let notificationName = t('sshSuspend.notifications.defaultSessionName');
        if (suspendedSession) {
          notificationName = suspendedSession.customSuspendName || suspendedSession.connectionName || notificationName;
        }
        uiNotificationsStore.addNotification({
          type: 'success',
          message: t('sshSuspend.notifications.resumeSuccess', { name: notificationName }),
        });
      }
    } catch (error) {
      resetReplacementState();
      restoreContextActiveSession();
      console.error(`[${t('term.sshSuspend')}] 处理会话恢复通知时出错:`, error);
      if (resumeContext?.notifyOnError ?? true) {
        uiNotificationsStore.addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.resumeErrorGeneric', { error: String(error) }),
        });
      }
    } finally {
      pendingResumeContexts.delete(payload.newFrontendSessionId);
      resumeContext?.complete();
    }

    const resumedSessionIndex = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === payload.suspendSessionId);
    if (resumedSessionIndex !== -1) {
      suspendedSshSessions.value.splice(resumedSessionIndex, 1);
    }
    // 同时移除已经被替换掉的本地 marked_active 影子条目。
    suspendedSshSessions.value = mergeMarkedActiveSessions(suspendedSshSessions.value);
  } else {
    resetReplacementState();
    pendingResumeContexts.delete(payload.newFrontendSessionId);
    if (resumeContext?.notifyOnError ?? true) {
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorBackend', { error: payload.error || t('term.unknownError') }),
      });
    }
    console.error(`[${t('term.sshSuspend')}] 后端报告恢复会话失败 (挂起 ID: ${payload.suspendSessionId}): ${payload.error}`);
    if (sessions.value.has(payload.newFrontendSessionId)) {
      closeSession(payload.newFrontendSessionId);
    }
    restoreContextActiveSession();
    resumeContext?.complete();
  }
};

const handleSshOutputCachedChunk = (payload: SshOutputCachedChunkPayload, message?: WebSocketMessage): void => {
  const session = sessions.value.get(payload.frontendSessionId) as SessionState | undefined;
  if (session && session.terminalManager) {
    if (session.terminalManager.terminalInstance.value) {
      // 终端实例已就绪，直接写入
      if (payload.isLastChunk && payload.data.length === 0) {
        session.isResuming = false;
        message?.acknowledge?.();
      } else {
        session.terminalManager.terminalInstance.value.write(payload.data, () => {
          message?.acknowledge?.();
          if (payload.isLastChunk) session.isResuming = false;
        });
      }
    } else {
      // 终端实例尚未就绪，暂存输出
      if (!session.pendingOutput) {
        session.pendingOutput = [];
      }
      const chunkBytes = typeof payload.data === 'string'
        ? terminalOutputEncoder.encode(payload.data).length
        : payload.data.byteLength;
      const nextBytes = (session.pendingOutputBytes ?? 0) + chunkBytes;
      if (nextBytes > MAX_PENDING_RESUME_OUTPUT_BYTES) {
        console.error(`[${t('term.sshSuspend')}] 恢复缓存超过 ${MAX_PENDING_RESUME_OUTPUT_BYTES} 字节，断开连接以触发后端事务回滚。`);
        session.pendingOutput = [];
        session.pendingOutputBytes = 0;
        closeSession(payload.frontendSessionId);
        return;
      }
      session.pendingOutput.push({ data: payload.data, acknowledge: message?.acknowledge });
      session.pendingOutputBytes = nextBytes;
      if (payload.isLastChunk) session.pendingOutputComplete = true;
      // console.log(`[${t('term.sshSuspend')}] (会话: ${payload.frontendSessionId}) 终端实例未就绪，已暂存数据块 (长度: ${payload.data.length})。当前暂存块数: ${session.pendingOutput.length}`);
    }

  } else {
    console.warn(`[${t('term.sshSuspend')}] 收到缓存数据块，但找不到对应会话或其终端管理器 (ID: ${payload.frontendSessionId})`);
  }
};

const handleSshSuspendTerminatedResp = (payload: SshSuspendTerminatedRespPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_TERMINATED_RESP:`, payload);
  if (payload.success) {
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === payload.suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.terminatedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.terminateError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 终止挂起会话失败 (ID: ${payload.suspendSessionId}): ${payload.error}`);
  }
};

const handleSshSuspendEntryRemovedResp = (payload: SshSuspendEntryRemovedRespPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_ENTRY_REMOVED_RESP:`, payload);
  if (payload.success) {
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === payload.suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.entryRemovedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.entryRemovedError', { error: payload.error || t('term.unknownError') }),
    });
    console.error(`[${t('term.sshSuspend')}] 移除挂起条目失败 (ID: ${payload.suspendSessionId}): ${payload.error}`);
  }
};

// handleSshSuspendNameEditedResp removed as edit is now via HTTP

const handleSshSuspendAutoTerminatedNotif = (payload: SshSuspendAutoTerminatedNotifPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  console.log(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_AUTO_TERMINATED_NOTIF:`, payload);
  const session = suspendedSshSessions.value.find(s => s.suspendSessionId === payload.suspendSessionId);
  if (session) {
    session.backendSshStatus = 'disconnected_by_backend'; // 使用正确的字段名
    session.disconnectionTimestamp = new Date().toISOString(); // 更新为 ISO 字符串
    // 可以在 SuspendedSshSession 类型中添加 disconnectionReason 字段
    // session.disconnectionReason = payload.reason;
    uiNotificationsStore.addNotification({
      type: 'warning',
      message: t('sshSuspend.notifications.autoTerminated', { name: session.customSuspendName || session.connectionName, reason: payload.reason }),
    });
  }
};

/**
 * 注册 SSH 挂起相关的 WebSocket 消息处理器。
 * 此函数应在 WebSocket 连接建立后，针对每个会话的 wsManager 实例调用。
 * @param wsManager 与特定 SSH 会话关联的 WebSocket 管理器实例
 */
export const registerSshSuspendHandlers = (wsManager: WsManagerInstance): void => {
  console.log(`[${t('term.sshSuspend')}] 尝试为 WebSocket 管理器注册 SSH 挂起处理器...`);

  if (!wsManager) {
    console.error(`[${t('term.sshSuspend')}] 注册处理器失败：wsManager 未定义。`);
    return;
  }

  // 注意：wsManager.onMessage 返回一个注销函数，如果需要，可以收集它们并在会话关闭时调用。
  // 但通常这些处理器会随 wsManager 实例的生命周期一起存在。
  wsManager.onMessage('SSH_MARKED_FOR_SUSPEND_ACK', (p: MessagePayload) => handleSshMarkedForSuspendAck(p as SshMarkedForSuspendAckPayload));
  wsManager.onMessage('SSH_UNMARKED_FOR_SUSPEND_ACK', (p: MessagePayload) => handleSshUnmarkedForSuspendAck(p as SshUnmarkedForSuspendAckPayload)); 
  wsManager.onMessage('SSH_SUSPEND_LIST_RESPONSE', (p: MessagePayload) => handleSshSuspendListResponse(p as SshSuspendListResponsePayload));
  wsManager.onMessage('SSH_SUSPEND_RESUMED_NOTIF', (p: MessagePayload) => handleSshSuspendResumedNotif(p as SshSuspendResumedNotifPayload));
  wsManager.onMessage('SSH_OUTPUT_CACHED_CHUNK', (p: MessagePayload, message: WebSocketMessage) => handleSshOutputCachedChunk(p as SshOutputCachedChunkPayload, message));
  wsManager.onMessage('SSH_SUSPEND_TERMINATED_RESP', (p: MessagePayload) => handleSshSuspendTerminatedResp(p as SshSuspendTerminatedRespPayload));
  wsManager.onMessage('SSH_SUSPEND_ENTRY_REMOVED_RESP', (p: MessagePayload) => handleSshSuspendEntryRemovedResp(p as SshSuspendEntryRemovedRespPayload));
  // SSH_SUSPEND_NAME_EDITED_RESP handler removed
  wsManager.onMessage('SSH_SUSPEND_AUTO_TERMINATED_NOTIF', (p: MessagePayload) => handleSshSuspendAutoTerminatedNotif(p as SshSuspendAutoTerminatedNotifPayload));

  console.log(`[${t('term.sshSuspend')}] SSH 挂起模式的 WebSocket 消息处理器已注册 (移除了名称编辑相关的处理器)。`);

  // SuspendedSshSessionsView fetches and polls while it is visible. Fetching the same
  // global list for every new SSH tab adds unrelated HTTP work to the connect path.
};
