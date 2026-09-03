import { ClientState } from './types';
import { WorkspaceSftpSessionService } from '../sftp/workspace-sftp-session.service';
import { SftpUploadService } from '../uploads/sftp-upload.service';
import { StatusMonitorService } from '../services/status-monitor.service';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { DockerService } from '../docker/docker.service';
import { settingsService } from '../settings/settings.service'; // 添加导入
import { ArchiveService } from '../archive/archive.service';
import { SftpTransferService } from '../transfers/sftp-transfer.service';

// 存储所有活动客户端的状态 (key: sessionId)
export const clientStates = new Map<string, ClientState>();

// --- 服务实例化 ---
// 将 clientStates 传递给需要访问共享状态的服务
export const workspaceSftpSessionService = new WorkspaceSftpSessionService(clientStates);
export const sftpUploadService = new SftpUploadService(clientStates);
export const archiveService = new ArchiveService(clientStates);
export const sftpTransferService = new SftpTransferService(clientStates);
export const statusMonitorService = new StatusMonitorService(clientStates);
export const auditLogService = new AuditLogService(); // 实例化 AuditLogService
export const notificationService = new NotificationService(); // 添加实例
export const dockerService = new DockerService(); // 实例化 DockerService (主要用于类型或未来可能的本地调用)
export { settingsService }; // 导出 settingsService
