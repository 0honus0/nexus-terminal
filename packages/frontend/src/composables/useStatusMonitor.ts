import { ref, readonly, watch, type Ref, type ComputedRef } from 'vue';
import type { ServerStatus } from '../types/server.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';

export interface StatusMonitorDependencies {
    sendMessage: (message: WebSocketMessage) => void;
    onMessage: (type: string, handler: (payload: any, fullMessage?: WebSocketMessage) => void) => () => void;
    isConnected: ComputedRef<boolean>;
}

export function createStatusMonitorManager(sessionId: string, wsDeps: StatusMonitorDependencies) {
    const { sendMessage, onMessage, isConnected } = wsDeps;
    const MAX_HISTORY_POINTS = 1800; // 最长保留约 30 分钟（1 秒采样时）

    const serverStatus = ref<ServerStatus | null>(null);
    const statusError = ref<string | null>(null);
    const cpuHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
    const memUsedHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
    const swapPercentHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
    const diskPercentHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
    const netRxHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
    const netTxHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));

    let consumerCount = 0;
    let subscribed = false;
    let unregisterUpdate: (() => void) | null = null;
    let unregisterError: (() => void) | null = null;
    let unregisterConnected: (() => void) | null = null;

    const updateHistory = (historyRef: Ref<(number | null)[]>, value: number | undefined) => {
        historyRef.value = [...historyRef.value.slice(1), Number.isFinite(value) ? value! : null];
    };

    const handleStatusUpdate = (payload: MessagePayload, message?: WebSocketMessage) => {
        if (message?.sessionId && message.sessionId !== sessionId) return;
        if (!payload?.status) return;

        const status = payload.status as ServerStatus;
        serverStatus.value = status;
        statusError.value = null;
        updateHistory(cpuHistory, status.cpuPercent);
        updateHistory(memUsedHistory, status.memUsed);
        updateHistory(swapPercentHistory, status.swapPercent);
        updateHistory(diskPercentHistory, status.diskPercent);
        updateHistory(netRxHistory, status.netRxRate);
        updateHistory(netTxHistory, status.netTxRate);
    };

    const handleStatusError = (payload: MessagePayload, message?: WebSocketMessage) => {
        if (message?.sessionId && message.sessionId !== sessionId) return;
        statusError.value = typeof payload === 'string'
            ? payload
            : payload?.message || '获取服务器状态时发生未知错误';
    };

    const registerHandlers = () => {
        if (!unregisterUpdate) {
            unregisterUpdate = onMessage('status_update', handleStatusUpdate);
        }
        if (!unregisterError) {
            unregisterError = onMessage('status:error', handleStatusError);
        }
        if (!unregisterConnected) {
            unregisterConnected = onMessage('ssh:connected', () => {
                if (consumerCount === 0) return;
                // 恢复流程中 WebSocket 打开时会暂时处于 connected，但此时后端的
                // SSH ClientState 还未建立，过早发送的订阅会被忽略。收到真正的
                // ssh:connected 后重新订阅，确保状态采集器一定启动。
                subscribed = false;
                subscribe();
            });
        }
    };

    const unregisterHandlers = () => {
        unregisterUpdate?.();
        unregisterError?.();
        unregisterConnected?.();
        unregisterUpdate = null;
        unregisterError = null;
        unregisterConnected = null;
    };

    const subscribe = () => {
        if (subscribed || consumerCount === 0 || !isConnected.value) return;
        registerHandlers();
        sendMessage({ type: 'status:subscribe', sessionId, payload: {} });
        subscribed = true;
    };

    const unsubscribe = () => {
        if (subscribed && isConnected.value) {
            sendMessage({ type: 'status:unsubscribe', sessionId, payload: {} });
        }
        subscribed = false;
        unregisterHandlers();
    };

    const activate = () => {
        consumerCount += 1;
        subscribe();
    };

    const deactivate = () => {
        consumerCount = Math.max(0, consumerCount - 1);
        if (consumerCount === 0) unsubscribe();
    };

    const refreshInterval = () => {
        if (consumerCount === 0 || !isConnected.value) return;
        if (subscribed) {
            sendMessage({ type: 'status:unsubscribe', sessionId, payload: {} });
            subscribed = false;
        }
        subscribe();
    };

    const stopConnectionWatch = watch(isConnected, connected => {
        if (connected) {
            subscribe();
        } else {
            subscribed = false;
            unregisterHandlers();
        }
    });

    const cleanup = () => {
        consumerCount = 0;
        unsubscribe();
        stopConnectionWatch();
    };

    return {
        serverStatus: readonly(serverStatus),
        statusError: readonly(statusError),
        cpuHistory: readonly(cpuHistory),
        memUsedHistory: readonly(memUsedHistory),
        swapPercentHistory: readonly(swapPercentHistory),
        diskPercentHistory: readonly(diskPercentHistory),
        netRxHistory: readonly(netRxHistory),
        netTxHistory: readonly(netTxHistory),
        activate,
        deactivate,
        refreshInterval,
        registerStatusHandlers: activate,
        unregisterAllStatusHandlers: deactivate,
        cleanup,
    };
}

export function useStatusMonitor() {
    const serverStatus = ref<ServerStatus | null>(null);
    const statusError = ref<string | null>(null);
    return {
        serverStatus: readonly(serverStatus),
        statusError: readonly(statusError),
        registerStatusHandlers: () => undefined,
        unregisterAllStatusHandlers: () => undefined,
    };
}
