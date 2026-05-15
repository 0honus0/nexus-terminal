import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

// 定义支持的事件类型
// 这里可以根据 packages/backend/src/locales/zh-CN.json 中的 event 部分来扩展
export enum AppEventType {
  TestNotification = 'testNotification', // 用于测试
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailure = 'LOGIN_FAILURE',
  Logout = 'LOGOUT',
  PasswordChanged = 'PASSWORD_CHANGED',
  TwoFactorEnabled = '2FA_ENABLED',
  TwoFactorDisabled = '2FA_DISABLED',
  ConnectionCreated = 'CONNECTION_CREATED',
  ConnectionUpdated = 'CONNECTION_UPDATED',
  ConnectionDeleted = 'CONNECTION_DELETED',
  ProxyCreated = 'PROXY_CREATED',
  ProxyUpdated = 'PROXY_UPDATED',
  ProxyDeleted = 'PROXY_DELETED',
  TagCreated = 'TAG_CREATED',
  TagUpdated = 'TAG_UPDATED',
  TagDeleted = 'TAG_DELETED',
  SettingsUpdated = 'SETTINGS_UPDATED',
  IpWhitelistUpdated = 'IP_WHITELIST_UPDATED',
  NotificationSettingCreated = 'NOTIFICATION_SETTING_CREATED',
  NotificationSettingUpdated = 'NOTIFICATION_SETTING_UPDATED',
  NotificationSettingDeleted = 'NOTIFICATION_SETTING_DELETED',
  SshConnectSuccess = 'SSH_CONNECT_SUCCESS',
  SshConnectFailure = 'SSH_CONNECT_FAILURE',
  SshShellFailure = 'SSH_SHELL_FAILURE',
  SshDisconnect = 'SSH_DISCONNECT',
  SshSessionSuspended = 'SSH_SESSION_SUSPENDED',
  // Passkey 事件
  PasskeyRegistered = 'PASSKEY_REGISTERED',
  PasskeyAuthSuccess = 'PASSKEY_AUTH_SUCCESS',
  PasskeyAuthFailure = 'PASSKEY_AUTH_FAILURE',
  PasskeyDeleted = 'PASSKEY_DELETED',
  // 批量任务事件
  BatchTaskCreated = 'BATCH_TASK_CREATED',
  BatchTaskCompleted = 'BATCH_TASK_COMPLETED',
  BatchTaskFailed = 'BATCH_TASK_FAILED',
  BatchTaskCancelled = 'BATCH_TASK_CANCELLED',
  // 备份事件
  BackupExportCompleted = 'BACKUP_EXPORT_COMPLETED',
  BackupExportFailed = 'BACKUP_EXPORT_FAILED',
  BackupImportCompleted = 'BACKUP_IMPORT_COMPLETED',
  BackupImportFailed = 'BACKUP_IMPORT_FAILED',
  // Docker 事件
  DockerContainerStarted = 'DOCKER_CONTAINER_STARTED',
  DockerContainerStopped = 'DOCKER_CONTAINER_STOPPED',
  DockerContainerRemoved = 'DOCKER_CONTAINER_REMOVED',
  DockerContainerCommandFailed = 'DOCKER_CONTAINER_COMMAND_FAILED',
  // SFTP 事件
  SftpConnectSuccess = 'SFTP_CONNECT_SUCCESS',
  SftpConnectFailure = 'SFTP_CONNECT_FAILURE',
  // 系统事件
  DatabaseMigration = 'DATABASE_MIGRATION',
  AdminSetupComplete = 'ADMIN_SETUP_COMPLETE',
}

// 定义事件负载的通用接口，可以根据具体事件扩展
export interface AppEventPayload {
  userId?: number; // 事件关联的用户 ID（如果适用）
  timestamp: Date; // 事件发生的时间戳
  details?: Record<string, unknown>; // 事件相关的具体数据
  [key: string]: unknown; // 允许其他任意属性
}

class EventService extends EventEmitter {
  constructor() {
    super();
    // 增加监听器数量限制，防止潜在的内存泄漏警告
    this.setMaxListeners(50);
  }

  /**
   * 触发一个应用事件
   * @param eventType 事件类型
   * @param payload 事件负载数据
   */
  emitEvent(eventType: AppEventType, payload: Omit<AppEventPayload, 'timestamp'>) {
    const fullPayload: AppEventPayload = {
      ...payload,
      timestamp: new Date(),
    };
    this.emit(eventType, fullPayload);
    logger.info(`Event emitted: ${eventType}`, fullPayload); // 日志记录，方便调试
  }

  /**
   * 注册事件监听器
   * @param eventType 事件类型
   * @param listener 监听函数
   */
  onEvent(eventType: AppEventType, listener: (payload: AppEventPayload) => void) {
    this.on(eventType, listener);
  }

  /**
   * 移除事件监听器
   * @param eventType 事件类型
   * @param listener 监听函数
   */
  offEvent(eventType: AppEventType, listener: (payload: AppEventPayload) => void) {
    this.off(eventType, listener);
  }
}

// 创建单例
const eventService = new EventService();

export default eventService;
