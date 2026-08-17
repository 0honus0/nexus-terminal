import { ref, shallowRef, computed, readonly } from 'vue';
import { useI18n } from 'vue-i18n'; // +++ Add import for useI18n +++
// 从 websocket.types.ts 导入并重新导出 ConnectionStatus
import type { ConnectionStatus as WsConnectionStatusType, MessagePayload, WebSocketMessage, MessageHandler } from '../types/websocket.types';
import {
    parseTerminalBinaryFrame,
    TerminalFrameFlag,
    TerminalFrameType,
} from '../utils/terminalBinaryProtocol';

// 导出类型别名，以便其他模块可以使用
export type WsConnectionStatus = WsConnectionStatusType;

/**
 * 创建并管理单个 WebSocket 连接实例。
 * 每个实例对应一个会话 (Session)。
 *
 * @param {string} sessionId - 此 WebSocket 连接关联的会话 ID (用于日志记录)。
 * @param {string} dbConnectionId - 此 WebSocket 连接关联的数据库连接 ID (用于后端识别)。
 * @param {Function} t - i18n 翻译函数，从父组件传入
 * @param {object} [options] - 可选参数对象
 * @param {boolean} [options.isResumeFlow=false] - 指示此连接是否用于 SSH 恢复流程
 * @returns 一个包含状态和方法的 WebSocket 连接管理器对象。
 */
export function createWebSocketConnectionManager(
    sessionId: string,
    dbConnectionId: string,
    t: ReturnType<typeof useI18n>['t'],
    options?: {
        isResumeFlow?: boolean;
        getIsMarkedForSuspend?: () => boolean;
        getTerminalDimensions?: () => { cols: number; rows: number } | undefined;
    }
) {
    // --- Instance State ---
    // 每个实例拥有独立的 WebSocket 对象、状态和消息处理器
    const ws = shallowRef<WebSocket | null>(null); // WebSocket 实例
    const isResumeFlow = options?.isResumeFlow ?? false; // 获取恢复流程标志
    const connectionStatus = ref<WsConnectionStatus>('disconnected'); // 连接状态 (使用导出的类型)
    const statusMessage = ref<string>(''); // 状态描述文本
    const isSftpReady = ref<boolean>(false); // SFTP 是否就绪
    const messageHandlers = new Map<string, Set<MessageHandler>>(); // 此实例的消息处理器注册表
    const instanceSessionId = sessionId; // 保存会话 ID 用于日志
    const instanceDbConnectionId = dbConnectionId; // 保存数据库连接 ID
    const getIsMarkedForSuspend = options?.getIsMarkedForSuspend; // +++ 获取回调函数 +++
    let reconnectAttempts = 0; // 重连尝试次数
    const maxReconnectAttempts = 5; // 首次连接失败仍限制次数，避免配置错误时无限重试
    const reconnectMaxDelayMs = 30000; // 已建立过连接的会话断线后最多每 30 秒重试一次
    let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null; // 重连定时器 ID
    let hasConnectedOnce = false; // 区分首次连接失败与已建立会话后的断线
    let lastUrl = ''; // 保存上次连接的 URL
    let intentionalDisconnect = false; // 标记是否为用户主动断开
    let lastTerminalFrameSequence: number | null = null;


    /**
     * 安全地获取状态文本的辅助函数
     * @param {string} statusKey - i18n 键名 (例如 'connectingWs')
     * @param {Record<string, unknown>} [params] - i18n 插值参数
     * @returns {string} 翻译后的文本或键名本身 (如果翻译失败)
     */
    const getStatusText = (statusKey: string, params?: Record<string, unknown>): string => {
        try {
            const translated = t(`workspace.status.${statusKey}`, params || {});
            return translated === `workspace.status.${statusKey}` ? statusKey : translated;
        } catch (e) {
            console.warn(`[WebSocket ${instanceSessionId}] i18n 错误 (键: workspace.status.${statusKey}):`, e);
            return statusKey;
        }
    };

    /**
     * 将收到的消息分发给已注册的处理器
     * @param {string} type - 消息类型
     * @param {MessagePayload} payload - 消息负载
     * @param {WebSocketMessage} fullMessage - 完整的消息对象
     */
    const dispatchMessage = (type: string, payload: MessagePayload, fullMessage: WebSocketMessage) => {
        if (messageHandlers.has(type)) {
            messageHandlers.get(type)?.forEach(handler => {
                try {
                    handler(payload, fullMessage);
                } catch (e) {
                    console.error(`[WebSocket ${instanceSessionId}] 消息处理器错误 (类型: "${type}"):`, e);
                }
            });
        }
    };

    /**
     * 安排 WebSocket 重连尝试
     */
    const scheduleReconnect = () => {
        if (intentionalDisconnect) {
            return; // 如果是主动断开，则不重连
        }

        // +++ 检查是否标记为待挂起 +++
        if (getIsMarkedForSuspend && getIsMarkedForSuspend()) {
            statusMessage.value = getStatusText('markedForSuspendNoReconnect'); // 可以为此添加新的i18n文本
            connectionStatus.value = 'disconnected'; // 保持断开状态或设为特定状态
            return;
        }

        // 首次连接失败保持原来的上限；一旦会话成功建立过，后续断线则持续周期重试。
        if (!hasConnectedOnce && reconnectAttempts >= maxReconnectAttempts) {
            statusMessage.value = getStatusText('reconnectFailed');
            connectionStatus.value = 'error'; // 标记为错误状态
            return;
        }

        // ssh:error / ssh:disconnected / WebSocket close 可能连续到达。
        // 同一轮断线只保留一个定时器，避免重复计数和重复建连。
        if (reconnectTimeoutId) {
            return;
        }

        reconnectAttempts++;
        // 2s, 4s, 8s, 16s, 30s，之后保持 30s 周期重试。
        const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, reconnectMaxDelayMs);
        statusMessage.value = getStatusText('reconnecting', { attempt: reconnectAttempts, delay: delay / 1000 });
        // 退避等待期间保持 disconnected，让任意键可以立即打断等待并重连。
        connectionStatus.value = 'disconnected';

        reconnectTimeoutId = setTimeout(() => {
            reconnectTimeoutId = null;
            if (!intentionalDisconnect && lastUrl) { // 再次检查是否主动断开
                connect(lastUrl);
            }
        }, delay);
    };

    /**
     * 建立 WebSocket 连接
     * @param {string} url - WebSocket 服务器 URL
     */
    const connect = (url: string) => {
        lastUrl = url; // 保存 URL 以便重连
        intentionalDisconnect = false; // 重置主动断开标记
        if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId); // 清除可能存在的重连定时器
            reconnectTimeoutId = null;
        }

        // --- 修改后的检查逻辑 ---
        // 只有当 ws 实例存在，且其状态为 OPEN 或 CONNECTING，
        // 并且我们自己维护的状态也是 connected 或 connecting 时，才阻止连接。
        if (ws.value &&
            (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING) &&
            (connectionStatus.value === 'connected' || connectionStatus.value === 'connecting')
           ) {
            console.warn(`[WebSocket ${instanceSessionId}] 连接已打开或正在连接中 (readyState: ${ws.value.readyState}, status: ${connectionStatus.value})。 阻止重复连接。`);
            return;
        }

        // 处理状态不一致或旧连接未完全关闭的情况
        if (ws.value && (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING)) {
             // readyState 是 OPEN/CONNECTING 但 connectionStatus 是 disconnected/error
             console.warn(`[WebSocket ${instanceSessionId}] 检测到状态不一致 (readyState: ${ws.value.readyState}, status: ${connectionStatus.value})。尝试关闭旧连接并继续...`);
             // 临时标记为主动断开，防止 onclose 触发 scheduleReconnect
             const oldWs = ws.value; // 保存旧 ws 引用
             const previousIntentionalDisconnect = intentionalDisconnect;
             intentionalDisconnect = true;
             // 在关闭前移除监听器，防止旧的 onclose 干扰
             if (oldWs) {
                 console.log(`[WebSocket ${instanceSessionId}] 移除旧连接的事件监听器...`);
                 oldWs.onopen = null;
                 oldWs.onmessage = null;
                 oldWs.onerror = null;
                 oldWs.onclose = null; // 阻止旧的 onclose 干扰
                 console.log(`[WebSocket ${instanceSessionId}] 关闭旧连接 (强制)...`);
                 oldWs.close(1000, '状态不一致，强制重连');
             }
             ws.value = null; // 清理 shallowRef 中的引用
             intentionalDisconnect = previousIntentionalDisconnect; // 恢复标记
             console.log(`[WebSocket ${instanceSessionId}] 旧连接处理完毕。`);
        } else if (ws.value && ws.value.readyState === WebSocket.CLOSING) {
             console.log(`[WebSocket ${instanceSessionId}] 检测到旧连接正在关闭 (readyState: ${ws.value.readyState})。清理引用并继续创建新连接...`);
             ws.value = null; // 清理引用，让后续逻辑创建新的
        }
        // 如果 ws.value 存在且 readyState 是 CLOSED，它应该已经在 onclose 中被设为 null

        statusMessage.value = getStatusText('connectingWs', { url });
        connectionStatus.value = 'connecting'; // 确保状态设置为 connecting
        isSftpReady.value = false; // 重置 SFTP 状态

        try {
            // --- 根据页面协议调整 WebSocket URL ---
            let secureUrl = url;
            if (window.location.protocol === 'https:') {
                secureUrl = url.replace(/^ws:/, 'wss:');
                console.log(`[WebSocket ${instanceSessionId}] HTTPS detected, upgrading WebSocket URL to: ${secureUrl}`);
            } else {
                 console.log(`[WebSocket ${instanceSessionId}] HTTP detected, using WebSocket URL: ${secureUrl}`);
            }
            // --- 使用调整后的 URL ---
            ws.value = new WebSocket(secureUrl);
            ws.value.binaryType = 'arraybuffer';

            ws.value.onopen = () => {
                lastTerminalFrameSequence = null;
                statusMessage.value = getStatusText('wsConnected');
                // 状态保持 'connecting' 直到收到 ssh:connected
                if (!isResumeFlow) {
                    // Reuse the already-rendered frontend session ID to avoid re-keying and
                    // remounting the terminal after SSH authentication completes. Also open
                    // the PTY at its real size instead of creating 80x24 and resizing later.
                    const dimensions = options?.getTerminalDimensions?.();
                    sendMessage({
                        type: 'ssh:connect',
                        payload: {
                            connectionId: instanceDbConnectionId,
                            clientSessionId: instanceSessionId,
                            ...(dimensions ? dimensions : {}),
                        },
                    });
                } else {
                    // 对于恢复流程，WebSocket 打开即表示连接基础已建立
                    // 后续的 SSH_SUSPEND_RESUME_REQUEST 会完成会话的恢复
                    connectionStatus.value = 'connected';
                }
                dispatchMessage('internal:opened', {}, { type: 'internal:opened' }); // 触发内部打开事件
            };

            ws.value.onmessage = (event: MessageEvent) => {
                try {
                    const rawData = event.data;
                    if (rawData instanceof ArrayBuffer) {
                        let frame;
                        try {
                            frame = parseTerminalBinaryFrame(rawData);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            console.error(`[WebSocket ${instanceSessionId}] 终端二进制协议错误:`, error);
                            connectionStatus.value = 'error';
                            statusMessage.value = `终端二进制协议错误: ${message}`;
                            isSftpReady.value = false;
                            intentionalDisconnect = true;
                            ws.value?.close(1003, 'Terminal binary protocol error');
                            dispatchMessage('internal:error', error, { type: 'internal:error' });
                            return;
                        }
                        if (lastTerminalFrameSequence !== null) {
                            const expectedSequence = (lastTerminalFrameSequence + 1) >>> 0;
                            if (frame.sequence !== expectedSequence) {
                                const message = `终端帧序号不连续，期望 ${expectedSequence}，收到 ${frame.sequence}`;
                                console.error(`[WebSocket ${instanceSessionId}] ${message}`);
                                connectionStatus.value = 'error';
                                statusMessage.value = message;
                                intentionalDisconnect = true;
                                ws.value?.close(1003, 'Terminal frame sequence error');
                                return;
                            }
                        }
                        lastTerminalFrameSequence = frame.sequence;
                        let acknowledged = false;
                        const acknowledge = () => {
                            if (acknowledged) return;
                            acknowledged = true;
                            sendMessage({ type: 'ssh:output:ack', payload: { sequence: frame.sequence } });
                        };

                        if (frame.type === TerminalFrameType.Output) {
                            dispatchMessage('ssh:output', frame.payload, {
                                type: 'ssh:output',
                                encoding: 'binary',
                                sequence: frame.sequence,
                                acknowledge,
                            });
                        } else {
                            dispatchMessage('SSH_OUTPUT_CACHED_CHUNK', {
                                frontendSessionId: instanceSessionId,
                                data: frame.payload,
                                isLastChunk: (frame.flags & TerminalFrameFlag.Final) !== 0,
                            }, {
                                type: 'SSH_OUTPUT_CACHED_CHUNK',
                                encoding: 'binary',
                                sequence: frame.sequence,
                                acknowledge,
                            });
                        }
                        return;
                    }
                    if (typeof rawData !== 'string') {
                        throw new Error(`不支持的 WebSocket 消息数据类型: ${Object.prototype.toString.call(rawData)}`);
                    }
                    const message: WebSocketMessage = JSON.parse(rawData);

                    // --- 更新此实例的连接状态 ---
                    if (message.type === 'ssh:connected') {
                        hasConnectedOnce = true;
                        reconnectAttempts = 0; // SSH 真正恢复后再重置退避计数
                        if (connectionStatus.value !== 'connected') {
                            connectionStatus.value = 'connected';
                            statusMessage.value = getStatusText('connected');
                        }
                    } else if (message.type === 'ssh:disconnected') {
                        if (connectionStatus.value !== 'disconnected') {
                            connectionStatus.value = 'disconnected';
                            statusMessage.value = getStatusText('disconnected', { reason: message.payload || '未知原因' });
                            isSftpReady.value = false; // SSH 断开，SFTP 也应不可用
                        }
                        scheduleReconnect();
                    } else if (message.type === 'ssh:error') {
                        if (connectionStatus.value !== 'disconnected' && connectionStatus.value !== 'error') {
                            connectionStatus.value = 'error';
                            let errorMsg = message.payload || '未知错误';
                            if (typeof errorMsg === 'object' && errorMsg.message) errorMsg = errorMsg.message;
                            statusMessage.value = getStatusText('error', { message: errorMsg });
                            isSftpReady.value = false;
                        }
                        // 已经成功建立过 SSH 后出现 ssh:error，通常表示传输层或 Shell 已失效。
                        // WebSocket 本身可能仍是 OPEN，因此不能只依赖 onclose 来启动重连。
                        if (hasConnectedOnce) scheduleReconnect();
                    } else if (message.type === 'error') {
                        // Generic protocol/operation errors are not equivalent to the
                        // underlying SSH transport being disconnected. Marking the whole
                        // session as errored here used to flip isSftpReady to false and
                        // leave FileManager actions disabled even though SSH/SFTP was
                        // still usable (for example after an unsupported/non-fatal WS
                        // request). Individual consumers still receive the error below.
                        console.warn(`[WebSocket ${instanceSessionId}] 收到非致命通用错误:`, message.payload);
                    } else if (message.type === 'sftp_ready') {
                        console.log(`[WebSocket ${instanceSessionId}] SFTP 会话已就绪。`);
                        isSftpReady.value = true;
                    }
                    // --- 状态更新结束 ---

                    // 分发消息给此实例的处理器
                    dispatchMessage(message.type, message.payload, message);

                } catch (e) {
                    console.error(`[WebSocket ${instanceSessionId}] 处理消息时出错:`, e, '原始数据:', event.data);
                    dispatchMessage('internal:raw', event.data, { type: 'internal:raw' });
                }
            };

            ws.value.onerror = (event) => {
                if (connectionStatus.value !== 'disconnected' && connectionStatus.value !== 'error') { // Don't override if already explicitly disconnected
                    connectionStatus.value = 'error';
                    statusMessage.value = getStatusText('wsError');
                }
                dispatchMessage('internal:error', event, { type: 'internal:error' });
                isSftpReady.value = false;
                // onerror is normally followed by onclose. Let onclose clear the socket and
                // schedule exactly one reconnect; doing both here used to double-count attempts.
            };

            ws.value.onclose = (event) => {
                // 只有在非错误状态下才更新为 disconnected
                if (connectionStatus.value !== 'error' && connectionStatus.value !== 'disconnected') { // Avoid redundant sets or overriding 'error'
                    connectionStatus.value = 'disconnected';
                    // 如果不是主动断开，显示尝试重连的消息
                    if (!intentionalDisconnect && event.code !== 1000) { // 1000 is normal closure
                         statusMessage.value = getStatusText('wsClosedWillRetry', { code: event.code });
                    } else {
                         statusMessage.value = getStatusText('wsClosed', { code: event.code });
                    }
                }
                dispatchMessage('internal:closed', { code: event.code, reason: event.reason }, { type: 'internal:closed' });
                isSftpReady.value = false;
                ws.value = null; // 清理实例引用

                // 如果不是主动断开 (code 1000)，尝试重连
                if (!intentionalDisconnect && event.code !== 1000) { // 1000 is normal closure
                    scheduleReconnect();
                }
            };
        } catch (err) {
             connectionStatus.value = 'error';
             statusMessage.value = getStatusText('wsError');
             isSftpReady.value = false;
             ws.value = null;
        }
    };

    /**
     * 立即重连。用于断线状态下的键盘输入：取消当前退避等待，并马上尝试一次。
     */
    const reconnectNow = () => {
        if (getIsMarkedForSuspend && getIsMarkedForSuspend()) {
            return;
        }
        if (!lastUrl) {
            console.warn(`[WebSocket ${instanceSessionId}] 无法立即重连：没有可用的上次连接 URL。`);
            return;
        }
        connect(lastUrl);
    };

    /**
     * 手动断开此 WebSocket 连接
     */
    const disconnect = () => {
        intentionalDisconnect = true; // 标记为主动断开
        if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId); // 清除重连定时器
            reconnectTimeoutId = null;
        }
        if (ws.value) {
            if (connectionStatus.value !== 'disconnected') {
                 connectionStatus.value = 'disconnected';
                 statusMessage.value = getStatusText('disconnected', { reason: '手动断开' });
            }
             ws.value.close(1000, '客户端主动断开'); // 使用标准代码和原因
             ws.value = null;
             isSftpReady.value = false;
             // 手动断开时可以考虑清除处理器，取决于是否需要重连逻辑
             // messageHandlers.clear();
        }
    };

    /**
     * 发送 WebSocket 消息
     * @param {WebSocketMessage} message - 要发送的消息对象
     */
    const sendMessage = (message: WebSocketMessage) => {
        if (ws.value && ws.value.readyState === WebSocket.OPEN) {
            try {
                const messageString = JSON.stringify(message);
                ws.value.send(messageString);
            } catch (e) {
                console.error(`[WebSocket ${instanceSessionId}] 序列化或发送消息失败:`, e, {
                    type: message.type,
                    requestId: message.requestId,
                });
            }
        } else {
            console.warn(`[WebSocket ${instanceSessionId}] 无法发送消息，连接未打开。状态: ${connectionStatus.value}, ReadyState: ${ws.value?.readyState}`);
        }
    };

    /**
     * Send an already encoded binary protocol frame without JSON/base64 wrapping.
     * Wait for the browser send queue to drain before adding more upload data. Without
     * this guard, several concurrent uploads can grow bufferedAmount until the proxy or
     * browser closes the socket and triggers a reconnect.
     */
    const sendBinaryMessage = async (
        frame: ArrayBuffer,
        maxBufferedBytes = 8 * 1024 * 1024,
    ): Promise<void> => {
        const socket = ws.value;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error(`WebSocket 未连接，无法发送二进制消息（状态: ${connectionStatus.value}）`);
        }

        const highWaterMark = Math.max(frame.byteLength, maxBufferedBytes);
        while (
            socket === ws.value
            && socket.readyState === WebSocket.OPEN
            && socket.bufferedAmount + frame.byteLength > highWaterMark
        ) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
        }

        if (socket !== ws.value || socket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket 在等待发送缓冲区时已断开');
        }

        try {
            socket.send(frame);
        } catch (error) {
            console.error(`[WebSocket ${instanceSessionId}] 发送二进制消息失败:`, error);
            throw error;
        }
    };

    /**
     * 注册一个消息处理器
     * @param {string} type - 要监听的消息类型
     * @param {MessageHandler} handler - 处理函数
     * @returns {Function} 一个用于注销此处理器的函数
     */
    const onMessage = (type: string, handler: MessageHandler): (() => void) => {
        if (!messageHandlers.has(type)) {
            messageHandlers.set(type, new Set());
        }
        const handlersSet = messageHandlers.get(type);
        if (handlersSet) {
             handlersSet.add(handler);
             // console.debug(`[WebSocket ${instanceSessionId}] 已注册处理器: ${type}`);
        }

        // 返回注销函数
        return () => {
            const currentSet = messageHandlers.get(type);
            if (currentSet) {
                currentSet.delete(handler);
                // console.debug(`[WebSocket ${instanceSessionId}] 已注销处理器: ${type}`);
                if (currentSet.size === 0) {
                    messageHandlers.delete(type);
                }
            }
        };
    };

    // 注意：没有在此处使用 onUnmounted。
    // disconnect 方法需要由外部调用者 (例如 WorkspaceView) 在会话关闭时显式调用。

    // 返回此实例的状态和方法
    return {
        // 状态 (只读引用)
        isConnected: computed(() => connectionStatus.value === 'connected'),
        isSftpReady: readonly(isSftpReady),
        connectionStatus: readonly(connectionStatus),
        statusMessage: readonly(statusMessage),

        // 方法
        connect,
        reconnectNow,
        disconnect,
        sendMessage,
        sendBinaryMessage,
        onMessage,
    };
}
