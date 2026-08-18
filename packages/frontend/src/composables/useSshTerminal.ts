import { ref, readonly, type Ref, ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { resolveSessionId, sessions as globalSessionsRef } from '../stores/session/state'; // +++ 导入全局 sessions state +++
// import { useWebSocketConnection } from './useWebSocketConnection'; // 移除全局导入
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon, ISearchOptions } from '@xterm/addon-search'; // *** 移除 ISearchResult 导入 ***
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';

// 定义与 WebSocket 相关的依赖接口
export interface SshTerminalDependencies {
    sendMessage: (message: WebSocketMessage) => void;
    onMessage: (type: string, handler: (payload: any, fullMessage?: WebSocketMessage) => void) => () => void;
    isConnected: ComputedRef<boolean>;
}

/**
 * 创建一个 SSH 终端管理器实例
 * @param sessionId 会话唯一标识符
 * @param wsDeps WebSocket 依赖对象
 * @param t i18n 翻译函数，从父组件传入
 * @returns SSH 终端管理器实例
 */
export function createSshTerminalManager(sessionId: string, wsDeps: SshTerminalDependencies, t: ReturnType<typeof useI18n>['t']) { // +++ Update type of t +++
    // 使用依赖注入的 WebSocket 函数
    const { sendMessage, onMessage, isConnected } = wsDeps;
    const getResolvedSessionId = () => resolveSessionId(sessionId);
    const isMessageForCurrentSession = (message?: WebSocketMessage) => (
        !message?.sessionId || resolveSessionId(message.sessionId) === getResolvedSessionId()
    );

    const terminalInstance = ref<Terminal | null>(null);
    const searchAddon = ref<SearchAddon | null>(null); // Keep searchAddon ref
    // Removed search result state refs
    // const searchResultCount = ref(0);
    // const currentSearchResultIndex = ref(-1);
    interface BufferedTerminalOutput {
        data: string | Uint8Array;
        acknowledge?: () => void;
    }
    const terminalOutputBuffer: BufferedTerminalOutput[] = []; // 非响应式队列，仅在终端未挂载时使用
    const MAX_BUFFERED_OUTPUT_BYTES = 1024 * 1024;
    const DIRECT_INPUT_MAX_CODE_UNITS = 256;
    const MAX_INPUT_CHUNK_CODE_UNITS = 32 * 1024;
    const MAX_INPUT_IN_FLIGHT_BYTES = 128 * 1024;
    const outputEncoder = new TextEncoder();
    let bufferedOutputBytes = 0;
    let terminalOutputBufferHead = 0;
    let lastSentCols = 0;
    let lastSentRows = 0;
    let nextInputSequence = 0;
    let inputBytesInFlight = 0;
    const inputQueue: Array<{ data: string; sequence: number; bytes: number }> = [];
    const pendingInputBytes = new Map<number, number>();
    const isSshConnected = ref(false); // 跟踪 SSH 连接状态
    // 仅在当前前端会话生命周期内记录是否至少真正完成过一次 SSH 握手。
    // 初次连接阶段要屏蔽输入；成功连接后的断线则仍允许“任意键立即重连”。
    const hasSshConnectedOnce = ref(false);

    const outputSize = (data: string | Uint8Array): number => (
        typeof data === 'string' ? outputEncoder.encode(data).length : data.byteLength
    );

    const bufferTerminalOutput = (data: string | Uint8Array, acknowledge?: () => void) => {
        terminalOutputBuffer.push({ data, acknowledge });
        bufferedOutputBytes += outputSize(data);
        while (bufferedOutputBytes > MAX_BUFFERED_OUTPUT_BYTES && terminalOutputBuffer.length - terminalOutputBufferHead > 1) {
            const removed = terminalOutputBuffer[terminalOutputBufferHead];
            terminalOutputBufferHead += 1;
            bufferedOutputBytes -= outputSize(removed.data);
            removed.acknowledge?.();
        }
        if (terminalOutputBufferHead > 1024 && terminalOutputBufferHead * 2 > terminalOutputBuffer.length) {
            terminalOutputBuffer.splice(0, terminalOutputBufferHead);
            terminalOutputBufferHead = 0;
        }
    };

    const drainTerminalOutputBuffer = (): BufferedTerminalOutput[] => {
        const buffered = terminalOutputBuffer.slice(terminalOutputBufferHead);
        terminalOutputBuffer.length = 0;
        terminalOutputBufferHead = 0;
        bufferedOutputBytes = 0;
        return buffered;
    };

    const flushInputQueue = (): void => {
        while (inputQueue.length > 0) {
            const next = inputQueue[0];
            if (inputBytesInFlight > 0 && inputBytesInFlight + next.bytes > MAX_INPUT_IN_FLIGHT_BYTES) break;
            inputQueue.shift();
            pendingInputBytes.set(next.sequence, next.bytes);
            inputBytesInFlight += next.bytes;
            sendMessage({ type: 'ssh:input', sessionId: getResolvedSessionId(), payload: next });
        }
    };

    const enqueueInputChunk = (data: string): void => {
        const sequence = nextInputSequence;
        nextInputSequence = (nextInputSequence + 1) >>> 0;
        inputQueue.push({ data, sequence, bytes: outputEncoder.encode(data).length });
    };

    const sendInputData = (data: string): void => {
        // SSH 尚未真正建立时不把输入发到后端。初次连接期间由上层直接屏蔽输入；
        // 已连接后断线的“任意键立即重连”也会在到达这里前被 WorkspaceView 接管。
        if (!isSshConnected.value) return;

        // Normal typing should take the shortest possible path. The backend already
        // accepts unsequenced SSH input, so small interactive writes do not need a
        // round-trip ACK. Large paste/command payloads keep the existing ACK-based
        // flow control to preserve bounded memory and ordering under backpressure.
        if (
            data.length <= DIRECT_INPUT_MAX_CODE_UNITS
            && inputQueue.length === 0
            && inputBytesInFlight === 0
        ) {
            sendMessage({
                type: 'ssh:input',
                sessionId: getResolvedSessionId(),
                payload: { data },
            });
            return;
        }

        if (data.length <= MAX_INPUT_CHUNK_CODE_UNITS) {
            enqueueInputChunk(data);
            flushInputQueue();
            return;
        }

        let offset = 0;
        while (offset < data.length) {
            let end = Math.min(offset + MAX_INPUT_CHUNK_CODE_UNITS, data.length);
            if (end < data.length) {
                const lastCodeUnit = data.charCodeAt(end - 1);
                if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) end -= 1;
            }
            enqueueInputChunk(data.slice(offset, end));
            offset = end;
        }
        flushInputQueue();
    };

    // 辅助函数：获取终端消息文本
    const getTerminalText = (key: string, params?: Record<string, any>): string => {
        // 确保 i18n key 存在，否则返回原始 key
        const translationKey = `workspace.terminal.${key}`;
        const translated = t(translationKey, params || {});
        return translated === translationKey ? key : translated;
    };

    // --- 终端事件处理 ---

    // *** 更新 handleTerminalReady 签名以接收 searchAddon ***
    const handleTerminalReady = (payload: { terminal: Terminal; searchAddon: SearchAddon | null }) => {
        const { terminal: term, searchAddon: addon } = payload;
        console.log(`[会话 ${sessionId}][SSH终端模块] 终端实例已就绪。SearchAddon 实例:`, addon ? '存在' : '不存在');
        terminalInstance.value = term;
        searchAddon.value = addon; // *** 存储 searchAddon 实例 ***

        // SSH 可能先于 xterm 组件完成连接。终端实例就绪后强制补发当前尺寸，
        // 避免此前 Shell 未就绪时发送的 resize 被后端忽略后又被前端去重。
        if (isSshConnected.value && term.cols > 0 && term.rows > 0) {
            handleTerminalResize({ cols: term.cols, rows: term.rows }, true);
        }

        
        // 1. 处理 SessionState.pendingOutput (来自 SSH_OUTPUT_CACHED_CHUNK 的早期数据)
        const currentSessionState = globalSessionsRef.value.get(getResolvedSessionId());
        if (currentSessionState && currentSessionState.pendingOutput && currentSessionState.pendingOutput.length > 0) {
            const pendingOutput = currentSessionState.pendingOutput;
            const completesResume = currentSessionState.pendingOutputComplete === true;
            // console.log(`[会话 ${sessionId}][SSH终端模块] 发现 SessionState.pendingOutput，长度: ${currentSessionState.pendingOutput.length}。正在写入...`);
            pendingOutput.forEach((entry, index) => {
                const isLast = index === pendingOutput.length - 1;
                if (isLast && completesResume && entry.data.length === 0) {
                    currentSessionState.isResuming = false;
                    entry.acknowledge?.();
                    return;
                }
                term.write(entry.data, () => {
                    entry.acknowledge?.();
                    if (isLast && completesResume) currentSessionState.isResuming = false;
                });
            });
            currentSessionState.pendingOutput = []; // 清空
            currentSessionState.pendingOutputBytes = 0;
            currentSessionState.pendingOutputComplete = false;
            // console.log(`[会话 ${sessionId}][SSH终端模块] SessionState.pendingOutput 处理完毕。`);
        }

        // 2. 将此管理器内部缓冲的输出 (terminalOutputBuffer, 来自 ssh:output) 写入终端
        if (terminalOutputBuffer.length > terminalOutputBufferHead) {
            drainTerminalOutputBuffer().forEach(entry => {
                 term.write(entry.data, entry.acknowledge);
            });
        }
        
        // 可以在这里自动聚焦或执行其他初始化操作
        // term.focus(); // 也许在 ssh:connected 时聚焦更好
    };

    const handleTerminalDetached = (payload: { terminal: Terminal; snapshot?: string }) => {
        if (terminalInstance.value !== payload.terminal) return;
        terminalInstance.value = null;
        searchAddon.value = null;
        terminalOutputBuffer.length = 0;
        terminalOutputBufferHead = 0;
        bufferedOutputBytes = 0;
        if (payload.snapshot) bufferTerminalOutput(payload.snapshot);
    };

    const handleTerminalData = (data: string) => {
        // console.debug(`[会话 ${sessionId}][SSH终端模块] 接收到终端输入:`, data);
        sendInputData(data);
    };

    const handleTerminalResize = (dimensions: { cols: number; rows: number }, force = false) => {
        // 只有在连接状态下才发送 resize 命令给后端
        if (isConnected.value) {
            if (!Number.isInteger(dimensions.cols) || !Number.isInteger(dimensions.rows)
                || dimensions.cols < 2 || dimensions.rows < 1 || dimensions.cols > 1000 || dimensions.rows > 500) return;
            if (!force && dimensions.cols === lastSentCols && dimensions.rows === lastSentRows) return;
            lastSentCols = dimensions.cols;
            lastSentRows = dimensions.rows;
            sendMessage({ type: 'ssh:resize', sessionId: getResolvedSessionId(), payload: dimensions });
        }
    };

    // --- WebSocket 消息处理 ---

    const handleSshOutput = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (!isMessageForCurrentSession(message)) {
            return; // 忽略不属于此会话的消息
        }

        let outputData = payload;
        if (typeof outputData !== 'string' && !(outputData instanceof Uint8Array)) {
             console.warn(`[会话 ${sessionId}][SSH终端模块] 收到非字符串 ssh:output payload:`, outputData);
             try {
                 outputData = JSON.stringify(outputData); // 尝试序列化
             } catch {
                 outputData = String(outputData); // 最后手段：强制转字符串
             }
        }

        if (terminalInstance.value) {
            // console.log(`[会话 ${sessionId}][SSH前端] 终端实例存在，尝试写入...`);
            terminalInstance.value.write(outputData, message?.acknowledge);
            // console.log(`[会话 ${sessionId}][SSH前端] 写入完成。`);
        } else {
            // 如果终端还没准备好，先缓冲输出
            bufferTerminalOutput(outputData, message?.acknowledge);
        }
    };

    const handleSshConnected = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (!isMessageForCurrentSession(message)) {
            return; // 忽略不属于此会话的消息
        }

        console.log(`[会话 ${sessionId}][SSH终端模块] SSH 会话已连接。 Payload:`, payload, 'Full message:', message); // 更详细的日志
        isSshConnected.value = true; // 更新状态
        hasSshConnectedOnce.value = true;
        // 连接成功后聚焦终端
        terminalInstance.value?.focus();

        if (terminalInstance.value) {
            const currentDimensions = { cols: terminalInstance.value.cols, rows: terminalInstance.value.rows };
            // 检查尺寸是否有效
            if (currentDimensions.cols > 0 && currentDimensions.rows > 0) {
                console.log(`[会话 ${sessionId}][SSH终端模块] SSH 连接成功，主动发送初始尺寸:`, currentDimensions);
                handleTerminalResize(currentDimensions, true);
            } else {
                console.warn(`[会话 ${sessionId}][SSH终端模块] SSH 连接成功，但获取到的初始尺寸无效，跳过发送 resize:`, currentDimensions);
            }
        } else {
             console.debug(`[会话 ${sessionId}][SSH终端模块] SSH 已连接，等待终端实例就绪后补发初始 resize。`);
        }


        // 清空可能存在的旧缓冲（虽然理论上此时应该已经 ready 了）
        if (terminalOutputBuffer.length > terminalOutputBufferHead && terminalInstance.value) {
             console.warn(`[会话 ${sessionId}][SSH终端模块] SSH 连接时仍有缓冲数据，正在写入...`);
             drainTerminalOutputBuffer().forEach(entry => terminalInstance.value?.write(entry.data, entry.acknowledge));
        }
    };

    const handleSshInputAck = (payload: MessagePayload) => {
        const sequence = payload?.sequence;
        if (!Number.isInteger(sequence)) return;
        const bytes = pendingInputBytes.get(sequence);
        if (bytes === undefined) return;
        pendingInputBytes.delete(sequence);
        inputBytesInFlight = Math.max(0, inputBytesInFlight - bytes);
        flushInputQueue();
    };

    const handleSshDisconnected = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (!isMessageForCurrentSession(message)) {
            return; // 忽略不属于此会话的消息
        }

        const reason = payload || t('workspace.terminal.unknownReason'); // 使用 i18n 获取未知原因文本
        console.log(`[会话 ${sessionId}][SSH终端模块] SSH 会话已断开:`, reason);
        isSshConnected.value = false; // 更新状态
        lastSentCols = 0;
        lastSentRows = 0;
        inputQueue.length = 0;
        pendingInputBytes.clear();
        inputBytesInFlight = 0;
        terminalInstance.value?.writeln(`\r\n\x1b[31m${getTerminalText('disconnectMsg', { reason })}\x1b[0m`);
        // 可以在这里添加其他清理逻辑，例如禁用输入
    };

    const handleSshError = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (!isMessageForCurrentSession(message)) {
            return; // 忽略不属于此会话的消息
        }

        const errorMsg = payload || t('workspace.terminal.unknownSshError'); // 使用 i18n
        console.error(`[会话 ${sessionId}][SSH终端模块] SSH 错误:`, errorMsg);
        isSshConnected.value = false; // 更新状态
        lastSentCols = 0;
        lastSentRows = 0;
        inputQueue.length = 0;
        pendingInputBytes.clear();
        inputBytesInFlight = 0;
        terminalInstance.value?.writeln(`\r\n\x1b[31m${getTerminalText('genericErrorMsg', { message: errorMsg })}\x1b[0m`);
    };

    const handleSshStatus = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (!isMessageForCurrentSession(message)) {
            return; // 忽略不属于此会话的消息
        }

        // 这个消息现在由 useWebSocketConnection 处理以更新全局状态栏消息
        // 这里可以保留日志或用于其他特定于终端的 UI 更新（如果需要）
        const statusKey = payload?.key || 'unknown';
        const statusParams = payload?.params || {};
        console.log(`[会话 ${sessionId}][SSH终端模块] 收到 SSH 状态更新:`, statusKey, statusParams);
        // 可以在终端打印一些状态信息吗？
        // terminalInstance.value?.writeln(`\r\n\x1b[34m[状态: ${statusKey}]\x1b[0m`);
    };

    const handleInfoMessage = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (!isMessageForCurrentSession(message)) {
            return; // 忽略不属于此会话的消息
        }

        console.log(`[会话 ${sessionId}][SSH终端模块] 收到后端信息:`, payload);
        terminalInstance.value?.writeln(`\r\n\x1b[34m${getTerminalText('infoPrefix')} ${payload}\x1b[0m`);
    };

    const handleErrorMessage = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (!isMessageForCurrentSession(message)) {
            return; // 忽略不属于此会话的消息
        }

        // 通用错误也可能需要显示在终端
        const errorMsg = payload || t('workspace.terminal.unknownGenericError'); // 使用 i18n
        console.error(`[会话 ${sessionId}][SSH终端模块] 收到后端通用错误:`, errorMsg);
        terminalInstance.value?.writeln(`\r\n\x1b[31m${getTerminalText('errorPrefix')} ${errorMsg}\x1b[0m`);
    };


    // --- 注册 WebSocket 消息处理器 ---
    const unregisterHandlers: (() => void)[] = [];

    const registerSshHandlers = () => {
        unregisterHandlers.push(onMessage('ssh:output', handleSshOutput));
        unregisterHandlers.push(onMessage('ssh:input:ack', handleSshInputAck));
        unregisterHandlers.push(onMessage('ssh:connected', handleSshConnected));
        unregisterHandlers.push(onMessage('ssh:disconnected', handleSshDisconnected));
        unregisterHandlers.push(onMessage('ssh:error', handleSshError));
        unregisterHandlers.push(onMessage('ssh:status', handleSshStatus));
        unregisterHandlers.push(onMessage('info', handleInfoMessage));
        unregisterHandlers.push(onMessage('error', handleErrorMessage)); // 也处理通用错误
        console.log(`[会话 ${sessionId}][SSH终端模块] 已注册 SSH 相关消息处理器。`);
    };

    const unregisterAllSshHandlers = () => {
        console.log(`[会话 ${sessionId}][SSH终端模块] 注销 SSH 相关消息处理器...`);
        unregisterHandlers.forEach(unregister => unregister?.());
        unregisterHandlers.length = 0; // 清空数组
    };

    // 初始化时自动注册处理程序
    registerSshHandlers();

    // --- 清理函数 ---
    const cleanup = () => {
        unregisterAllSshHandlers();
        // terminalInstance.value?.dispose(); // 终端实例的销毁由 TerminalComponent 负责
        terminalInstance.value = null;
        console.log(`[会话 ${sessionId}][SSH终端模块] 已清理。`);
    };

    /**
     * 直接发送数据到 SSH 会话 (例如，从命令输入栏)
     * @param data 要发送的字符串数据
     */
    const sendData = (data: string) => {
        // console.debug(`[会话 ${sessionId}][SSH终端模块] 直接发送数据:`, data);
        sendInputData(data);
    };

    // --- 搜索相关方法 (移除计数逻辑) ---

    // Removed countOccurrences helper function

    const searchNext = (term: string, options?: ISearchOptions): boolean => {
        if (searchAddon.value) {
            console.log(`[会话 ${sessionId}][SSH终端模块] 执行 searchNext: "${term}"`);
            const found = searchAddon.value.findNext(term, options);
            // Removed manual count and state update
            return found;
        }
        console.warn(`[会话 ${sessionId}][SSH终端模块] searchNext 调用失败，searchAddon 不可用。`);
        // Removed state reset on failure
        return false;
    };

    const searchPrevious = (term: string, options?: ISearchOptions): boolean => {
        if (searchAddon.value) {
             console.log(`[会话 ${sessionId}][SSH终端模块] 执行 searchPrevious: "${term}"`);
            const found = searchAddon.value.findPrevious(term, options);
            // Removed manual count and state update
            return found;
        }
         console.warn(`[会话 ${sessionId}][SSH终端模块] searchPrevious 调用失败，searchAddon 不可用。`);
         // Removed state reset on failure
        return false;
    };

    const clearTerminalSearch = () => {
        if (searchAddon.value) {
            console.log(`[会话 ${sessionId}][SSH终端模块] 清除搜索高亮。`);
            searchAddon.value.clearDecorations();
        }
        // Removed state reset
        console.log(`[会话 ${sessionId}][SSH终端模块] 搜索高亮已清除 (状态不再管理)。`);
    };


    // 返回工厂实例
    return {
        // 公共接口
        handleTerminalReady,
        handleTerminalDetached,
        handleTerminalData, // 这个处理来自 xterm.js 的输入
        handleTerminalResize,
        sendData, // 允许外部直接发送数据
        cleanup,
        // --- 搜索方法 ---
        searchNext,
        searchPrevious,
        clearTerminalSearch,
        // --- 暴露状态 ---
        isSshConnected: readonly(isSshConnected), // 暴露 SSH 连接状态 (只读)
        hasSshConnectedOnce: readonly(hasSshConnectedOnce),
        terminalInstance, // 暴露 terminal 实例，以便 WorkspaceView 可以写入提示信息
    };
}

// 保留兼容旧代码的函数（将在完全迁移后移除）
export function useSshTerminal(t: (key: string) => string) {
    console.warn('⚠️ 使用已弃用的 useSshTerminal() 全局单例。请迁移到 createSshTerminalManager() 工厂函数。');
    
    const terminalInstance = ref<Terminal | null>(null);
    
    const handleTerminalReady = (term: Terminal) => {
        console.log('[SSH终端模块][旧] 终端实例已就绪，但使用了已弃用的单例模式。');
        terminalInstance.value = term;
    };
    
    const handleTerminalData = (data: string) => {
        console.warn('[SSH终端模块][旧] 收到终端数据，但使用了已弃用的单例模式，无法发送。');
    };
    
    const handleTerminalResize = (dimensions: { cols: number; rows: number }) => {
        console.warn('[SSH终端模块][旧] 收到终端大小调整，但使用了已弃用的单例模式，无法发送。');
    };
    
    // 返回与旧接口兼容的空函数，以避免错误
    return {
        terminalInstance,
        handleTerminalReady,
        handleTerminalData,
        handleTerminalResize,
        registerSshHandlers: () => console.warn('[SSH终端模块][旧] 调用了已弃用的 registerSshHandlers'),
        unregisterAllSshHandlers: () => console.warn('[SSH终端模块][旧] 调用了已弃用的 unregisterAllSshHandlers'),
    };
}
