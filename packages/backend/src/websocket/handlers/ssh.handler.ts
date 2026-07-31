import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedWebSocket, ClientState, WebSocketRequest } from '../types';
import { clientStates, sftpService, statusMonitorService, auditLogService, notificationService } from '../state';
import * as SshService from '../../services/ssh.service';
import { cleanupClientConnection } from '../utils';
import { temporaryLogStorageService } from '../../ssh-suspend/temporary-log-storage.service';
import { startDockerStatusPolling } from './docker.handler';
import WebSocket from 'ws';

const encodeForPosixPrintf = (value: string): string =>
    Array.from(value)
        .map(char => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`)
        .join('');

const SHELL_PROMPT_MARKER = '\x1b]777;NEXUS_PROMPT\x07';

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const sendSshRequestMessage = (state: ClientState, type: string, requestId: string, payload: Record<string, unknown>): void => {
    if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type, requestId, payload }));
    }
};

const executeSshCommand = (state: ClientState, command: string, timeoutMs = 5000): Promise<string> =>
    new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let channel: any;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve(stdout);
        };
        const timeout = setTimeout(() => {
            try { channel?.close(); } catch { /* ignore */ }
            finish(new Error('SSH command timed out'));
        }, timeoutMs);

        state.sshClient.exec(command, (err, stream) => {
            if (err) {
                finish(err);
                return;
            }
            channel = stream;
            stream.on('data', (data: Buffer) => { stdout += data.toString('utf8'); });
            stream.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf8'); });
            stream.on('error', (streamError: Error) => finish(streamError));
            stream.on('close', (code: number | undefined) => {
                if (code && code !== 0) {
                    finish(new Error(stderr.trim() || `SSH command exited with code ${code}`));
                } else {
                    finish();
                }
            });
        });
    });

const parseAbsolutePath = (output: string): string => {
    const candidate = output.replace(/\r/g, '').split('\n').map(line => line.trim()).find(line => line.startsWith('/'));
    if (!candidate) throw new Error('Remote command did not return an absolute path');
    return candidate;
};

const readShellCurrentPath = async (state: ClientState): Promise<string> => {
    if (!state.shellPid) throw new Error('Shell PID is unavailable');
    return parseAbsolutePath(await executeSshCommand(state, `readlink /proc/${state.shellPid}/cwd`, 5000));
};

const resolveRemoteDirectory = async (state: ClientState, requestedPath: string): Promise<string> =>
    parseAbsolutePath(await executeSshCommand(state, `cd ${quotePosixShellArg(requestedPath)} 2>/dev/null && pwd -P`, 5000));

const clearPendingDirectoryChange = (state: ClientState): void => {
    if (state.pendingDirectoryChange) clearTimeout(state.pendingDirectoryChange.timeout);
    state.pendingDirectoryChange = undefined;
};

async function handleShellPrompt(state: ClientState): Promise<void> {
    const pending = state.pendingDirectoryChange;
    if (!pending || !state.sshShellStream) return;

    if (!pending.executing) {
        pending.executing = true;
        state.shellAtPrompt = false;
        // The PTY echoes injected input and its Enter newline. Hide only this internal
        // command until the next prompt marker, then redraw the prompt in place.
        state.suppressOutputUntilPrompt = true;
        // The marker is emitted immediately before the shell starts reading a fresh line.
        // Ctrl-U defensively clears any stale line-editor buffer without touching a child process.
        state.sshShellStream.write(`\x15cd ${quotePosixShellArg(pending.path)}\r`);
        return;
    }

    clearPendingDirectoryChange(state);
    try {
        const currentPath = await readShellCurrentPath(state);
        if (currentPath !== pending.expectedPath) {
            throw new Error(`Shell remained in ${currentPath}`);
        }
        sendSshRequestMessage(state, 'ssh:change_directory:result', pending.requestId, { path: currentPath });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendSshRequestMessage(state, 'ssh:change_directory:error', pending.requestId, { error: message });
    }
}

const consumePromptMarkers = (state: ClientState, chunk: string): string => {
    const data = (state.shellControlRemainder || '') + chunk;
    state.shellControlRemainder = '';
    let visible = '';
    let cursor = 0;
    let markerIndex = data.indexOf(SHELL_PROMPT_MARKER, cursor);

    while (markerIndex !== -1) {
        if (state.suppressOutputUntilPrompt) {
            // Replace the old prompt line instead of forwarding the injected command echo
            // and the CR/LF produced by the remote terminal driver.
            visible += '\r\x1b[2K';
            state.suppressOutputUntilPrompt = false;
        } else {
            visible += data.slice(cursor, markerIndex);
        }
        state.shellAtPrompt = true;
        state.shellIntegrationReady = true;
        void handleShellPrompt(state);
        cursor = markerIndex + SHELL_PROMPT_MARKER.length;
        markerIndex = data.indexOf(SHELL_PROMPT_MARKER, cursor);
    }

    const tail = data.slice(cursor);
    let partialLength = 0;
    const maxPartial = Math.min(tail.length, SHELL_PROMPT_MARKER.length - 1);
    for (let length = maxPartial; length > 0; length--) {
        if (SHELL_PROMPT_MARKER.startsWith(tail.slice(-length))) {
            partialLength = length;
            break;
        }
    }

    const completeTail = partialLength > 0 ? tail.slice(0, -partialLength) : tail;
    if (!state.suppressOutputUntilPrompt) {
        visible += completeTail;
    }
    if (partialLength > 0) {
        state.shellControlRemainder = tail.slice(-partialLength);
    }
    return visible;
};

const buildPromptHookBody = (shellKind: 'bash' | 'zsh'): string => {
    const markerFunction = "__nexus_prompt_marker(){ printf '\\033]777;NEXUS_PROMPT\\007'; };";
    if (shellKind === 'bash') {
        return [
            markerFunction,
            "if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then",
            'case " ${PROMPT_COMMAND[*]} " in',
            '*" __nexus_prompt_marker "*) ;;',
            '*) PROMPT_COMMAND+=(__nexus_prompt_marker) ;;',
            'esac;',
            'else',
            'case ";${PROMPT_COMMAND-};" in',
            '*";__nexus_prompt_marker;"*) ;;',
            '*) PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}__nexus_prompt_marker" ;;',
            'esac;',
            'fi',
        ].join(' ');
    }
    return `autoload -Uz add-zsh-hook 2>/dev/null; ${markerFunction} add-zsh-hook -d precmd __nexus_prompt_marker 2>/dev/null; add-zsh-hook precmd __nexus_prompt_marker`;
};

const buildPromptHookCommand = (shellKind: 'bash' | 'zsh', startMarker: string, endMarker: string): string => {
    const encodedStart = encodeForPosixPrintf(startMarker);
    const encodedEnd = encodeForPosixPrintf(endMarker);
    return [
        'stty -echo 2>/dev/null;',
        `${buildPromptHookBody(shellKind)};`,
        `printf '\\n${encodedStart}ok${encodedEnd}\\n';`,
        'stty echo 2>/dev/null;',
        "printf '\\n'",
    ].join(' ') + '\r';
};

const installPromptHook = (state: ClientState): void => {
    if (!state.sshShellStream || (state.shellKind !== 'bash' && state.shellKind !== 'zsh')) return;

    const token = `${Date.now()}${Math.random().toString(36).slice(2)}`.replace(/[^a-zA-Z0-9]/g, '');
    const startMarker = `__NEXUS_HOOK_BEGIN_${token}__`;
    const endMarker = `__NEXUS_HOOK_END_${token}__`;
    const timeout = setTimeout(() => { state.shellSetup = undefined; }, 5000);
    state.shellSetup = { phase: 'hook', startMarker, endMarker, buffer: '', timeout };
    state.sshShellStream.write(buildPromptHookCommand(state.shellKind, startMarker, endMarker));
};

const consumeShellSetupOutput = (state: ClientState, chunk: string): string => {
    const pending = state.shellSetup;
    if (!pending) return chunk;

    pending.buffer += chunk;
    const startIndex = pending.buffer.indexOf(pending.startMarker);
    if (startIndex === -1) {
        const keep = Math.max(pending.startMarker.length - 1, 0);
        if (pending.buffer.length > keep) pending.buffer = pending.buffer.slice(-keep);
        return '';
    }
    const outputStart = startIndex + pending.startMarker.length;
    const endIndex = pending.buffer.indexOf(pending.endMarker, outputStart);
    if (endIndex === -1) return '';

    const output = pending.buffer.slice(outputStart, endIndex).trim();
    const trailingOutput = pending.buffer.slice(endIndex + pending.endMarker.length);
    clearTimeout(pending.timeout);
    state.shellSetup = undefined;

    if (pending.phase === 'probe') {
        const match = output.match(/^(\d+):(bash|zsh|other)$/);
        if (match) {
            state.shellPid = Number.parseInt(match[1], 10);
            state.shellKind = match[2] as 'bash' | 'zsh' | 'other';
            queueMicrotask(() => installPromptHook(state));
        }
    } else if (pending.phase === 'hook' && output === 'ok') {
        state.shellIntegrationReady = true;
    }
    return trailingOutput;
};

export const filterSshShellOutput = (state: ClientState, chunk: string): string => {
    const setupFiltered = consumeShellSetupOutput(state, chunk);
    return consumePromptMarkers(state, setupFiltered);
};

const buildShellProbeCommand = (startMarker: string, endMarker: string): string => {
    const encodedStart = encodeForPosixPrintf(startMarker);
    const encodedEnd = encodeForPosixPrintf(endMarker);
    return [
        'stty -echo 2>/dev/null;',
        'if [ -n "${BASH_VERSION-}" ]; then __nexus_shell_kind=bash; elif [ -n "${ZSH_VERSION-}" ]; then __nexus_shell_kind=zsh; else __nexus_shell_kind=other; fi;',
        `printf '\\n${encodedStart}%s:%s${encodedEnd}\\n' "$$" "$__nexus_shell_kind";`,
        'stty echo 2>/dev/null;',
        "printf '\\n'",
    ].join(' ') + '\r';
};

const startShellIntegration = (state: ClientState): void => {
    if (!state.sshShellStream) return;
    const token = `${Date.now()}${Math.random().toString(36).slice(2)}`.replace(/[^a-zA-Z0-9]/g, '');
    const startMarker = `__NEXUS_SHELL_BEGIN_${token}__`;
    const endMarker = `__NEXUS_SHELL_END_${token}__`;
    const timeout = setTimeout(() => { state.shellSetup = undefined; }, 5000);
    state.shellIntegrationReady = false;
    state.shellSetup = { phase: 'probe', startMarker, endMarker, buffer: '', timeout };
    state.sshShellStream.write(buildShellProbeCommand(startMarker, endMarker));
};


export async function handleSshConnect(
    ws: AuthenticatedWebSocket,
    request: WebSocketRequest,
    payload: any
): Promise<void> {
    const sessionId = ws.sessionId;
    const existingState = sessionId ? clientStates.get(sessionId) : undefined;

    if (sessionId && existingState) {
        console.warn(`WebSocket: 用户 ${ws.username} (会话: ${sessionId}) 已有活动连接，忽略新的连接请求。`);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: '已存在活动的 SSH 连接。' }));
        return;
    }

    const dbConnectionId = payload?.connectionId;
    if (!dbConnectionId) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: '缺少 connectionId。' }));
        return;
    }

    console.log(`WebSocket: 用户 ${ws.username} 请求连接到数据库 ID: ${dbConnectionId}`);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在处理连接请求...' }));

    const clientIp = request.clientIpAddress || 'unknown';
    let connInfo: SshService.DecryptedConnectionDetails | null = null;

    try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在获取连接信息...' }));
        connInfo = await SshService.getConnectionDetails(dbConnectionId);

        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: `正在连接到 ${connInfo.host}...` }));
        const sshClient = await SshService.establishSshConnection(connInfo);

        const newSessionId = uuidv4();
        ws.sessionId = newSessionId; // Assign new sessionId to the WebSocket

        const dbConnectionIdAsNumber = parseInt(dbConnectionId, 10);
        if (isNaN(dbConnectionIdAsNumber)) {
            console.error(`WebSocket: 无效的 dbConnectionId '${dbConnectionId}' (非数字)，无法创建会话 ${newSessionId}。`);
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: '无效的连接 ID。' }));
            sshClient.end();
            ws.close(1008, 'Invalid Connection ID');
            return;
        }

        const newState: ClientState = {
            ws: ws,
            sshClient: sshClient,
            dbConnectionId: dbConnectionIdAsNumber,
            connectionName: connInfo!.name,
            ipAddress: clientIp,
            isShellReady: false,
        };
        clientStates.set(newSessionId, newState);
        console.log(`WebSocket: 为用户 ${ws.username} (IP: ${clientIp}) 创建新会话 ${newSessionId} (DB ID: ${dbConnectionIdAsNumber}, 连接名称: ${newState.connectionName})`);

        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: 'SSH 连接成功，正在打开 Shell...' }));
        try {
            const defaultCols = payload?.cols || 80; // Use provided cols or default
            const defaultRows = payload?.rows || 24; // Use provided rows or default
            sshClient.shell({ term: payload?.term || 'xterm-256color', cols: defaultCols, rows: defaultRows }, (err, stream) => {
                if (err) {
                    console.error(`SSH: 会话 ${newSessionId} 打开 Shell 失败:`, err);
                    auditLogService.logAction('SSH_SHELL_FAILURE', {
                        connectionName: newState.connectionName,
                        userId: ws.userId,
                        username: ws.username,
                        connectionId: dbConnectionIdAsNumber,
                        sessionId: newSessionId,
                        ip: newState.ipAddress,
                        reason: err.message
                    });
                    notificationService.sendNotification('SSH_SHELL_FAILURE', {
                        userId: ws.userId,
                        username: ws.username,
                        connectionId: dbConnectionIdAsNumber,
                        sessionId: newSessionId,
                        ip: newState.ipAddress,
                        reason: err.message
                    });
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 失败: ${err.message}` }));
                    }
                    cleanupClientConnection(newSessionId);
                    return;
                }

                console.log(`WebSocket: 会话 ${newSessionId} Shell 打开成功 (尺寸 ${defaultCols}x${defaultRows})。`);
                newState.sshShellStream = stream;
                newState.isShellReady = true;

                stream.on('data', (data: Buffer) => {
                    const visibleOutput = filterSshShellOutput(newState, data.toString('utf8'));
                    if (visibleOutput && ws.readyState === WebSocket.OPEN) {
                        // 确保数据以 UTF-8 编码转换为 Base64
                        ws.send(JSON.stringify({ type: 'ssh:output', payload: Buffer.from(visibleOutput, 'utf8').toString('base64'), encoding: 'base64' }));
                    }
                    // 如果会话被标记为待挂起，则将输出写入日志
                    const currentState = clientStates.get(newSessionId); // 获取最新的状态
                    if (currentState?.isMarkedForSuspend && currentState.suspendLogPath) {
                        temporaryLogStorageService.writeToLog(currentState.suspendLogPath, data.toString('utf-8')).catch(err => {
                            console.error(`[SSH Handler] 写入标记会话 ${newSessionId} 的日志失败 (路径: ${currentState.suspendLogPath}):`, err);
                        });
                    }
                });
                stream.stderr.on('data', (data: Buffer) => {
                    console.error(`SSH Stderr (会话: ${newSessionId}): ${data.toString('utf8').substring(0, 100)}...`);
                    if (ws.readyState === WebSocket.OPEN) {
                        // 确保数据以 UTF-8 编码转换为 Base64
                        const utf8ErrData = data.toString('utf8');
                        ws.send(JSON.stringify({ type: 'ssh:output', payload: Buffer.from(utf8ErrData, 'utf8').toString('base64'), encoding: 'base64' }));
                    }
                    // 同样，如果会话被标记为待挂起，则将 stderr 输出写入日志
                    const currentState = clientStates.get(newSessionId);
                    if (currentState?.isMarkedForSuspend && currentState.suspendLogPath) {
                        temporaryLogStorageService.writeToLog(currentState.suspendLogPath, `[STDERR] ${data.toString('utf-8')}`).catch(err => {
                            console.error(`[SSH Handler] 写入标记会话 ${newSessionId} 的 STDERR 日志失败 (路径: ${currentState.suspendLogPath}):`, err);
                        });
                    }
                });
                startShellIntegration(newState);

                stream.on('close', () => {
                    console.log(`SSH: 会话 ${newSessionId} 的 Shell 通道已关闭。`);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ssh:disconnected', payload: 'Shell 通道已关闭。' }));
                    }
                    cleanupClientConnection(newSessionId);
                });

                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
                    type: 'ssh:connected',
                    payload: {
                        connectionId: dbConnectionIdAsNumber,
                        sessionId: newSessionId
                    }
                }));
                console.log(`WebSocket: 会话 ${newSessionId} SSH 连接和 Shell 建立成功。`);
                auditLogService.logAction('SSH_CONNECT_SUCCESS', {
                    userId: ws.userId,
                    username: ws.username,
                    connectionId: dbConnectionIdAsNumber,
                    sessionId: newSessionId,
                    ip: newState.ipAddress,
                    connectionName: connInfo!.name,
                });
                notificationService.sendNotification('SSH_CONNECT_SUCCESS', {
                    userId: ws.userId,
                    username: ws.username,
                    connectionId: dbConnectionIdAsNumber,
                    sessionId: newSessionId,
                    ip: newState.ipAddress
                });

                console.log(`WebSocket: 会话 ${newSessionId} 正在异步初始化 SFTP...`);
                sftpService.initializeSftpSession(newSessionId)
                    .then(() => console.log(`SFTP: 会话 ${newSessionId} 异步初始化成功。`))
                    .catch(sftpInitError => console.error(`WebSocket: 会话 ${newSessionId} 异步初始化 SFTP 失败:`, sftpInitError));

                statusMonitorService.startStatusPolling(newSessionId);
                startDockerStatusPolling(newSessionId); // Start Docker polling
            });
        } catch (shellError: any) {
            console.error(`SSH: 会话 ${newSessionId} 打开 Shell 时发生意外错误:`, shellError);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 时发生意外错误: ${shellError.message}` }));
            }
            cleanupClientConnection(newSessionId);
        }

        sshClient.on('close', () => {
            console.log(`SSH: 会话 ${newSessionId} 的客户端连接已关闭。`);
            cleanupClientConnection(newSessionId);
        });
        sshClient.on('error', (err: Error) => {
            console.error(`SSH: 会话 ${newSessionId} 的客户端连接错误:`, err);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ssh:error', payload: `SSH 连接错误: ${err.message}` }));
            }
            cleanupClientConnection(newSessionId);
        });

    } catch (connectError: any) {
        console.error(`WebSocket: 用户 ${ws.username} (IP: ${clientIp}) 连接到数据库 ID ${dbConnectionId} 失败:`, connectError);
        auditLogService.logAction('SSH_CONNECT_FAILURE', {
            userId: ws.userId,
            username: ws.username,
            connectionId: dbConnectionId,
            connectionName: connInfo?.name || 'Unknown',
            ip: clientIp,
            reason: connectError.message
        });
        notificationService.sendNotification('SSH_CONNECT_FAILURE', {
            userId: ws.userId,
            username: ws.username,
            connectionId: dbConnectionId,
            ip: clientIp,
            reason: connectError.message
        });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: `连接失败: ${connectError.message}` }));
        ws.close(1011, `SSH Connection Failed: ${connectError.message}`);
    }
}

export function handleSshInput(ws: AuthenticatedWebSocket, payload: any): void {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!state || !state.sshShellStream) {
        console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SSH 输入，但无活动 Shell。`);
        return;
    }
    const data = payload?.data;
    if (typeof data === 'string' && state.isShellReady) { // Check isShellReady
        // Any user input may be a partial command or belong to a foreground program.
        // Wait for the next explicit prompt marker before injecting a queued cd.
        state.shellAtPrompt = false;
        state.sshShellStream.write(data);
    } else if (!state.isShellReady) {
        console.warn(`WebSocket: 会话 ${sessionId} 收到 SSH 输入，但 Shell 尚未就绪。`);
    }
}

export async function handleSshExecSilent(ws: AuthenticatedWebSocket, payload: any, requestId?: string): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    const fail = (error: string) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ssh:exec_silent:error', requestId, payload: { error } }));
        }
    };

    if (!requestId || payload?.action !== 'pwd') {
        fail('无效的静默命令请求。');
        return;
    }
    if (!state?.sshClient || !state.isShellReady) {
        fail('SSH Shell 尚未就绪。');
        return;
    }
    if (!state.shellPid) {
        fail('终端路径集成尚未就绪，请稍后重试。');
        return;
    }

    try {
        // This runs on an independent SSH exec channel. Reading /proc/<shell>/cwd does
        // not write into the PTY, so cat/vim/sleep and other foreground jobs are untouched.
        const output = await readShellCurrentPath(state);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ssh:exec_silent:result', requestId, payload: { output } }));
        }
    } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
    }
}

export async function handleSshChangeDirectory(ws: AuthenticatedWebSocket, payload: any, requestId?: string): Promise<void> {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    const fail = (error: string) => {
        if (requestId && state) sendSshRequestMessage(state, 'ssh:change_directory:error', requestId, { error });
    };

    if (!requestId || typeof payload?.path !== 'string' || !payload.path.startsWith('/')) {
        fail('无效的终端目录切换请求。');
        return;
    }
    if (!state?.sshShellStream || !state.isShellReady || !state.shellPid || !state.shellIntegrationReady) {
        fail('终端路径集成尚未就绪。');
        return;
    }
    if (state.shellKind !== 'bash' && state.shellKind !== 'zsh') {
        fail('当前 Shell 不支持安全目录队列；为避免影响前台程序，未发送 cd。');
        return;
    }

    let expectedPath: string;
    try {
        expectedPath = await resolveRemoteDirectory(state, payload.path);
    } catch {
        fail('目标目录不存在或无权访问。');
        return;
    }

    if (state.pendingDirectoryChange) {
        const previous = state.pendingDirectoryChange;
        clearPendingDirectoryChange(state);
        sendSshRequestMessage(state, 'ssh:change_directory:error', previous.requestId, { error: '已被新的目录切换请求替代。' });
    }

    const timeout = setTimeout(() => {
        if (state.pendingDirectoryChange?.requestId !== requestId) return;
        clearPendingDirectoryChange(state);
        sendSshRequestMessage(state, 'ssh:change_directory:error', requestId, { error: '等待 Shell 返回提示符超时。' });
    }, 10 * 60 * 1000);
    state.pendingDirectoryChange = {
        requestId,
        path: payload.path,
        expectedPath,
        executing: false,
        timeout,
    };
    sendSshRequestMessage(state, 'ssh:change_directory:queued', requestId, {
        path: payload.path,
        waitingForPrompt: !state.shellAtPrompt,
    });

    if (state.shellAtPrompt) {
        await handleShellPrompt(state);
    }
}

export function handleSshResize(ws: AuthenticatedWebSocket, payload: any): void {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!state || !state.sshClient) { // sshClient is enough, stream might not be ready for resize yet
        console.warn(`WebSocket: 收到来自 ${ws.username} 的调整大小请求，但无有效会话或 SSH 客户端。`);
        return;
    }

    const { cols, rows } = payload || {};
    if (typeof cols !== 'number' || typeof rows !== 'number' || cols <= 0 || rows <= 0) {
        console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效调整大小请求:`, payload);
        return;
    }

    if (state.isShellReady && state.sshShellStream) {
        console.log(`SSH: 会话 ${sessionId} 调整终端大小: ${cols}x${rows}`);
        state.sshShellStream.setWindow(rows, cols, 0, 0);
    } else {
        // Store intended size if shell not ready, apply when shell is ready.
        // This part is a bit more complex as it requires modifying the shell opening logic.
        // For now, we just log if shell is not ready.
        console.warn(`WebSocket: 会话 ${sessionId} 收到调整大小请求，但 Shell 尚未就绪或流不存在 (isShellReady: ${state.isShellReady})。尺寸将不会立即应用。`);
        // A more robust solution would queue the resize or store it in ClientState to be applied later.
    }
}

// 处理会话恢复后的状态监控启动
export function handleSshResumeSuccess(sessionId: string): void {
    const state = clientStates.get(sessionId);
    if (state && state.sshClient) {
        statusMonitorService.startStatusPolling(sessionId);
        // 如果 Docker 状态也需要恢复，可以在这里添加
        // startDockerStatusPolling(sessionId);
    } else {
        console.error(`[SSH Handler ${sessionId}] 无法为恢复的会话启动状态轮询：未找到会话状态或 SSH 客户端。`);
    }
}
