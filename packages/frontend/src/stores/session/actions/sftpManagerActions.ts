// packages/frontend/src/stores/session/actions/sftpManagerActions.ts

import { ref } from 'vue';
import { resolveSessionId, sessions } from '../state';
import type { SftpManagerInstance } from '../types';
import { createSftpActionsManager, type WebSocketDependencies } from '../../../composables/useSftpActions'; // 路径: packages/frontend/src/composables/useSftpActions.ts
import type { useI18n } from 'vue-i18n';

export const getOrCreateSftpManager = (
    sessionId: string,
    instanceId: string,
    dependencies: {
        t: ReturnType<typeof useI18n>['t'];
    }
): SftpManagerInstance | null => {
    const resolvedSessionId = resolveSessionId(sessionId);
    const session = sessions.value.get(resolvedSessionId);
    if (!session) {
        console.error(`[SftpManagerActions] 尝试为不存在的会话 ${sessionId}（解析为 ${resolvedSessionId}）获取 SFTP 管理器`);
        return null;
    }
    const { t } = dependencies;

    let manager = session.sftpManagers.get(instanceId);
    if (!manager) {
        console.log(`[SftpManagerActions] 为会话 ${resolvedSessionId} 创建新的 SFTP 管理器实例: ${instanceId}`);
        const currentSftpPath = ref<string>('.'); // 每个实例有自己的路径
        const wsDeps: WebSocketDependencies = {
            sendMessage: session.wsManager.sendMessage,
            sendBinaryMessage: session.wsManager.sendBinaryMessage,
            sendUploadBinaryMessage: session.wsManager.sendUploadBinaryMessage,
            onMessage: session.wsManager.onMessage,
            isConnected: session.wsManager.isConnected,
            isSftpReady: session.wsManager.isSftpReady,
        };
        manager = createSftpActionsManager(resolvedSessionId, currentSftpPath, wsDeps, t, instanceId);
        session.sftpManagers.set(instanceId, manager);
    } else {
        manager.resumeLifecycle();
    }
    return manager;
};

export const removeSftpManager = (sessionId: string, instanceId: string) => {
    const resolvedSessionId = resolveSessionId(sessionId);
    const session = sessions.value.get(resolvedSessionId);
    if (session) {
        const manager = session.sftpManagers.get(instanceId);
        if (manager) {
            const finalizeRemoval = () => {
                const currentSession = sessions.value.get(resolvedSessionId);
                if (currentSession?.sftpManagers.get(instanceId) !== manager) return;
                manager.cleanup();
                currentSession.sftpManagers.delete(instanceId);
                console.log(`[SftpManagerActions] 已移除并清理会话 ${resolvedSessionId} 的 SFTP 管理器实例: ${instanceId}`);
            };

            if (manager.hasActiveOperations.value) {
                console.log(`[SftpManagerActions] 会话 ${resolvedSessionId} 的 SFTP 管理器 ${instanceId} 仍有长任务，延迟清理直到任务结束。`);
                manager.deferCleanupUntilIdle(finalizeRemoval);
            } else {
                finalizeRemoval();
            }
        }
    }
};
