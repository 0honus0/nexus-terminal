import { Client, Channel, ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  SuspendSessionDetails,
  SuspendedSessionsMap,
  BackendSshStatus,
  SuspendedSessionInfo,
} from '../types/ssh-suspend.types';
import { temporaryLogStorageService, TemporaryLogStorageService } from './temporary-log-storage.service';
// clientStates 的直接访问已移除，因为takeOverMarkedSession现在从调用者接收所需信息

export interface PreparedResumeSession {
  sshClient: Client;
  channel: ClientChannel;
  logIdentifier: string;
  connectionName: string;
  originalConnectionId: string;
  shellPid?: number;
  shellKind?: 'bash' | 'zsh' | 'other';
  shellIntegrationReady?: boolean;
  shellAtPrompt?: boolean;
}

/**
 * SshSuspendService 负责管理所有用户的挂起 SSH 会话的生命周期。
 */
export class SshSuspendService extends EventEmitter {
  private suspendedSessions: SuspendedSessionsMap = new Map();
  private readonly logStorageService: TemporaryLogStorageService;

  constructor(logStorage?: TemporaryLogStorageService) {
    super(); // 调用 EventEmitter 的构造函数
    this.logStorageService = logStorage || temporaryLogStorageService;
    // TODO: 考虑在服务启动时从日志目录加载持久化的 'disconnected_by_backend' 会话信息。
    // 这需要日志文件本身包含可解析的元数据。
  }

  /**
   * 获取用户特定的会话映射，如果不存在则创建。
   * @param userId 用户ID。
   * @returns 该用户的 Map<suspendSessionId, SuspendSessionDetails>。
   */
  private getUserSessions(userId: number): Map<string, SuspendSessionDetails> { // userId: string -> number
    if (!this.suspendedSessions.has(userId)) {
      this.suspendedSessions.set(userId, new Map<string, SuspendSessionDetails>());
    }
    return this.suspendedSessions.get(userId)!;
  }

  /**
   * 当一个被标记为待挂起的会话的 WebSocket 连接断开时，由此方法接管 SSH 资源。
   * @param details 包含接管所需的所有会话详细信息。
   * @returns Promise<string | null> 返回新生成的 suspendSessionId，如果无法接管则返回 null。
   */
  async takeOverMarkedSession(details: {
    userId: number;
    originalSessionId: string;
    sshClient: Client;
    channel: ClientChannel;
    connectionName: string;
    connectionId: string;
    logIdentifier: string;
    customSuspendName?: string;
    shellPid?: number;
    shellKind?: 'bash' | 'zsh' | 'other';
    shellIntegrationReady?: boolean;
    shellAtPrompt?: boolean;
  }): Promise<string | null> {
    const {
      userId,
      originalSessionId,
      sshClient,
      channel,
      connectionName,
      connectionId,
      logIdentifier,
      customSuspendName,
      shellPid,
      shellKind,
      shellIntegrationReady,
      shellAtPrompt,
    } = details;
    console.log(`[SshSuspendService DEBUG] takeOverMarkedSession: Called for userId=${userId}, originalSessionId=${originalSessionId}`);

    // 检查 SSH client 和 channel 是否仍然可用
    // ClientChannel 有 readable 和 writable, Client 本身没有直接的此类属性
    // 如果 channel 不可读写，通常意味着底层连接有问题。
    console.log(`[SshSuspendService DEBUG] takeOverMarkedSession: Checking channel for originalSessionId=${originalSessionId}. Readable: ${channel?.readable}, Writable: ${channel?.writable}`);
    if (!channel || !channel.readable || !channel.writable) {
        console.warn(`[SshSuspendService WARN] takeOverMarkedSession: userId=${userId}, originalSessionId=${originalSessionId}. SSH channel is not usable. readable=${channel?.readable}, writable=${channel?.writable}. Cannot take over.`);
        // 确保如果 SSH 连接已经关闭，日志文件仍然保留，但不创建挂起条目。
        // SshSuspendService 不会管理这个“已经断开”的会话，但日志保留供用户清理。
        try { channel?.end(); } catch (e) { /* ignore */ }
        try { sshClient?.end(); } catch (e) { /* ignore */ }
        return null; // 无法接管
    }

    const suspendSessionId = uuidv4();
    const userSessions = this.getUserSessions(userId);

    channel.removeAllListeners('data');
    channel.removeAllListeners('close');
    channel.removeAllListeners('error');
    channel.removeAllListeners('end');
    channel.removeAllListeners('exit');

    sshClient.removeAllListeners('error');
    sshClient.removeAllListeners('end');

    const sessionDetails: SuspendSessionDetails = {
      sshClient,
      channel,
      tempLogPath: logIdentifier, // 使用传入的日志标识符 (基于 originalSessionId)
      connectionName,
      connectionId,
      suspendStartTime: new Date().toISOString(),
      customSuspendName,
      backendSshStatus: 'hanging',
      originalSessionId,
      userId,
      shellPid,
      shellKind,
      shellIntegrationReady,
      shellAtPrompt,
    };

    userSessions.set(suspendSessionId, sessionDetails);
    console.log(`[SshSuspendService INFO] takeOverMarkedSession: userId=${userId}, originalSessionId=${originalSessionId} taken over. New suspendSessionId=${suspendSessionId}, initial status=${sessionDetails.backendSshStatus}. Log identifier=${logIdentifier}`);

    await this.logStorageService.ensureLogDirectoryExists();
    this.attachSuspendedSessionListeners(userSessions, suspendSessionId, sessionDetails);

    return suspendSessionId;
  }

  private attachSuspendedSessionListeners(
    userSessions: Map<string, SuspendSessionDetails>,
    suspendSessionId: string,
    session: SuspendSessionDetails,
  ): void {
    const { channel, sshClient, tempLogPath } = session;
    this.removeChannelListeners(channel, sshClient);

    channel.on('data', (data: Buffer) => {
      const current = userSessions.get(suspendSessionId);
      if (current?.backendSshStatus !== 'hanging' || current.resumeInProgress) return;
      void this.logStorageService.writeToLog(tempLogPath, data).catch(error => {
        console.error(`[SshSuspendService] 写入挂起日志失败 (${suspendSessionId}/${tempLogPath}):`, error);
      });
    });

    const terminate = (reasonSuffix: string) => {
      const current = userSessions.get(suspendSessionId);
      if (!current || current.backendSshStatus !== 'hanging') return;
      const reason = `SSH connection ${reasonSuffix}.`;
      current.backendSshStatus = 'disconnected_by_backend';
      current.disconnectionTimestamp = new Date().toISOString();
      current.resumeInProgress = false;
      this.removeChannelListeners(channel, sshClient);
      this.emit('sessionAutoTerminated', { userId: current.userId, suspendSessionId, reason });
    };

    channel.on('close', () => terminate('channel closed'));
    channel.on('error', () => terminate('channel errored'));
    channel.on('end', () => terminate('channel ended'));
    channel.on('exit', (code: number | null, signalName: string | null) => {
      terminate(`channel exited with code ${code}, signal ${signalName}`);
    });
    sshClient.on('error', () => terminate('client errored'));
    sshClient.on('end', () => terminate('client ended'));
  }
  
  private removeChannelListeners(channel: Channel, sshClient: Client): void {
    channel.removeAllListeners('data');
    channel.removeAllListeners('close');
    channel.removeAllListeners('error');
    channel.removeAllListeners('end');
    channel.removeAllListeners('exit');
    sshClient.removeAllListeners('error');
    sshClient.removeAllListeners('end');
  }

  /**
   * 列出指定用户的所有挂起会话（包括活跃和已断开的）。
   * 目前主要从内存中获取信息。
   * @param userId 用户ID。
   * @returns Promise<SuspendedSessionInfo[]> 挂起会话信息的数组。
   */
  async listSuspendedSessions(userId: number): Promise<SuspendedSessionInfo[]> {
    const userSessions = this.getUserSessions(userId);
    const sessionsInfo: SuspendedSessionInfo[] = [];

    for (const [suspendSessionId, details] of userSessions.entries()) {
      sessionsInfo.push({
        suspendSessionId,
        originalSessionId: details.originalSessionId,
        connectionName: details.connectionName,
        connectionId: details.connectionId,
        suspendStartTime: details.suspendStartTime,
        customSuspendName: details.customSuspendName,
        backendSshStatus: details.backendSshStatus,
        disconnectionTimestamp: details.disconnectionTimestamp,
      });
    }
    // TODO: 增强此方法以从日志目录恢复 'disconnected_by_backend' 的会话状态，
    // 这需要日志文件包含元数据。
    return sessionsInfo;
  }

  async prepareResumeSession(userId: number, suspendSessionId: string): Promise<PreparedResumeSession | null> {
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);
    if (!session || session.backendSshStatus !== 'hanging' || session.resumeInProgress) return null;

    session.resumeInProgress = true;
    session.channel.pause();
    this.removeChannelListeners(session.channel, session.sshClient);
    try {
      await this.logStorageService.flush(session.tempLogPath);
    } catch (error) {
      session.resumeInProgress = false;
      this.attachSuspendedSessionListeners(userSessions, suspendSessionId, session);
      session.channel.resume();
      return null;
    }
    return {
      sshClient: session.sshClient,
      channel: session.channel,
      logIdentifier: session.tempLogPath,
      connectionName: session.connectionName,
      originalConnectionId: session.connectionId,
      shellPid: session.shellPid,
      shellKind: session.shellKind,
      shellIntegrationReady: session.shellIntegrationReady,
      shellAtPrompt: session.shellAtPrompt,
    };
  }

  async commitResumeSession(userId: number, suspendSessionId: string): Promise<boolean> {
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);
    if (!session?.resumeInProgress) return false;
    // 从映射移除即为事务提交点；之后 cleanup 不得再回滚到挂起状态。
    userSessions.delete(suspendSessionId);
    try {
      await this.logStorageService.deleteLog(session.tempLogPath);
    } catch (error) {
      console.error(`[SshSuspendService] 恢复已提交，但删除日志 ${session.tempLogPath} 失败:`, error);
    }
    return true;
  }

  async rollbackResumeSession(userId: number, suspendSessionId: string): Promise<boolean> {
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);
    if (!session?.resumeInProgress) return false;
    session.resumeInProgress = false;
    if (!session.channel.readable || !session.channel.writable) {
      session.backendSshStatus = 'disconnected_by_backend';
      session.disconnectionTimestamp = new Date().toISOString();
      this.emit('sessionAutoTerminated', {
        userId,
        suspendSessionId,
        reason: 'SSH connection terminated while resume was being rolled back.',
      });
      return true;
    }
    this.attachSuspendedSessionListeners(userSessions, suspendSessionId, session);
    session.channel.resume();
    return true;
  }

  /**
   * 终止一个活跃的挂起会话。
   * @param userId 用户ID。
   * @param suspendSessionId 要终止的挂起会话ID。
   * @returns Promise<boolean> 操作是否成功。
   */
  async terminateSuspendedSession(userId: number, suspendSessionId: string): Promise<boolean> { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (!session || session.backendSshStatus !== 'hanging') {
      console.warn(`[用户: ${userId}] 尝试终止的会话 ${suspendSessionId} 不存在或不是活跃状态 (${session?.backendSshStatus})。`);
      // 如果会话已断开，但记录还在，也应该能被“终止”（即移除）
      if(session && session.backendSshStatus === 'disconnected_by_backend'){
        const logPathToDelete = session.tempLogPath; // 获取正确的日志路径
        userSessions.delete(suspendSessionId);
        await this.logStorageService.deleteLog(logPathToDelete);
        console.log(`[用户: ${userId}] 已断开的挂起会话条目 ${suspendSessionId} (日志: ${logPathToDelete}) 已通过终止操作移除。`);
        return true;
      }
      return false;
    }

    this.removeChannelListeners(session.channel, session.sshClient);

    try {
      session.channel.close(); // 尝试优雅关闭
    } catch (e) {
      console.warn(`[用户: ${userId}, 会话: ${suspendSessionId}] 关闭channel时出错:`, e);
    }
    try {
      session.sshClient.end(); // 尝试优雅关闭
    } catch (e) {
      console.warn(`[用户: ${userId}, 会话: ${suspendSessionId}] 关闭sshClient时出错:`, e);
    }
    
    const logPathToFinallyDelete = session.tempLogPath; // 获取正确的日志路径
    userSessions.delete(suspendSessionId);
    await this.logStorageService.deleteLog(logPathToFinallyDelete);

    console.log(`[用户: ${userId}] 活跃的挂起会话 ${suspendSessionId} (日志: ${logPathToFinallyDelete}) 已成功终止并移除。`);
    return true;
  }

  /**
   * 移除一个已断开的挂起会话条目。
   * @param userId 用户ID。
   * @param suspendSessionId 要移除的挂起会话ID。
   * @returns Promise<boolean> 操作是否成功。
   */
  async removeDisconnectedSessionEntry(userId: number, suspendSessionId: string): Promise<boolean> { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (!session) {
      console.warn(`[用户: ${userId}] 尝试移除不存在或不属于该用户的会话 ${suspendSessionId}。`);
      return false;
    }

    if (session && session.backendSshStatus === 'hanging') {
      console.warn(`[用户: ${userId}] 尝试移除的会话 ${suspendSessionId} 仍处于活跃状态，请先终止。`);
      return false; // 不允许直接移除活跃会话，应先终止
    }

    // 如果会话在内存中（不论状态），则删除
    userSessions.delete(suspendSessionId);
    
    // 总是尝试删除日志文件，因为它可能对应一个已不在内存中的断开会话
    try {
      const logPathToRemove = session.tempLogPath;
      await this.logStorageService.deleteLog(logPathToRemove);
      console.log(`[用户: ${userId}] 已断开的挂起会话条目 ${suspendSessionId} 的日志 (标识: ${logPathToRemove}) 已删除。`);
      return true;
    } catch (error) {
      console.error(`[用户: ${userId}] 删除会话 ${suspendSessionId} 的日志文件失败:`, error);
      // 即便日志删除失败，如果内存条目已删，也算部分成功。但严格来说应返回false。
      // 如果 session 不在内存中，但日志删除成功，也算成功。
      return false; 
    }
  }

  /**
   * 编辑挂起会话的自定义名称。
   * 目前仅更新内存中的名称。
   * @param userId 用户ID。
   * @param suspendSessionId 挂起会话ID。
   * @param newCustomName 新的自定义名称。
   * @returns Promise<boolean> 操作是否成功。
   */
  async editSuspendedSessionName(userId: number, suspendSessionId: string, newCustomName: string): Promise<boolean> { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (!session) {
      console.warn(`[用户: ${userId}] 尝试编辑名称的会话 ${suspendSessionId} 不存在。`);
      return false;
    }

    session.customSuspendName = newCustomName;
    console.log(`[用户: ${userId}] 挂起会话 ${suspendSessionId} 的自定义名称已更新为: ${newCustomName}`);
    // TODO: 如果设计要求将自定义名称持久化到日志文件的元数据部分，
    // 此处需要添加更新日志文件的逻辑。这可能涉及读取、修改元数据、然后重写文件。
    return true;
  }

  /**
   * 处理特定会话的 SSH 连接意外断开。
   * 此方法主要由内部事件监听器调用。
   * @param userId 用户ID。
   * @param suspendSessionId 发生断开的会话ID。
   */
  public handleUnexpectedDisconnection(userId: number, suspendSessionId: string): void { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (session && session.backendSshStatus === 'hanging') {
      const reason = 'Unexpected disconnection handled by SshSuspendService.';
      session.backendSshStatus = 'disconnected_by_backend';
      session.disconnectionTimestamp = new Date().toISOString();
      this.removeChannelListeners(session.channel, session.sshClient); // 移除监听器
      console.log(`[用户: ${userId}] 会话 ${suspendSessionId} 状态更新为 'disconnected_by_backend'。原因: ${reason}`);
      
      this.emit('sessionAutoTerminated', {
        userId: session.userId,
        suspendSessionId,
        reason
      });
      // 确保所有已缓冲的日志已尝试写入 (通常由 'data' 事件处理，这里是最终状态确认)
    }
  }

  /**
   * 获取指定挂起会话的日志内容。
   * 允许导出 'disconnected_by_backend' 和 'hanging' 状态的会话日志。
   * @param userId 用户ID。
   * @param suspendSessionId 要导出日志的挂起会话ID。
   * @returns Promise<{ content: string, filename: string } | null> 日志内容和建议的文件名，如果会话不符合条件或读取失败则返回null。
   */
  async getSessionLogStream(userId: number, suspendSessionId: string): Promise<{
    stream: NodeJS.ReadableStream;
    filename: string;
  } | null> {
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (!session) {
      return null;
    }

    if (session.backendSshStatus !== 'disconnected_by_backend' && session.backendSshStatus !== 'hanging') {
      return null;
    }

    if (!session.tempLogPath) {
        return null;
    }

    try {
      const baseName = session.customSuspendName || session.connectionName || suspendSessionId.substring(0,8);
      const safeBaseName = baseName.replace(/[^\w.-]/g, '_'); // 替换掉不安全字符为空格或下划线
      const timestamp = new Date(session.suspendStartTime).toISOString().replace(/[:.]/g, '-');
      // tempLogPath 通常是 originalSessionId
      const filename = `ssh_log_${safeBaseName}_${session.tempLogPath}_${timestamp}.log`;

      return {
        stream: await this.logStorageService.createLogReadStream(session.tempLogPath),
        filename,
      };
    } catch (error) {
      console.error(`[SshSuspendService][用户: ${userId}] 创建挂起日志流失败:`, error);
      return null;
    }
  }
}

// 单例模式导出
export const sshSuspendService = new SshSuspendService();
