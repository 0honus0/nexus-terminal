import { workspaceSessionRegistry } from '../workspace/workspace-session-registry';
import { WorkspaceSftpSessionService } from '../sftp/workspace-sftp-session.service';
import { SftpUploadService } from '../uploads/sftp-upload.service';
import { WorkspaceStatusMonitorService } from '../workspace/workspace-status-monitor.service';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { DockerService } from '../docker/docker.service';
import { settingsService } from '../settings/settings.service';
import { ArchiveService } from '../archive/archive.service';
import { SftpTransferService } from '../transfers/sftp-transfer.service';

// Application composition root. Protocol modules consume services from here but
// do not own their state or lifecycle.
export const workspaceSftpSessionService = new WorkspaceSftpSessionService(workspaceSessionRegistry);
export const sftpUploadService = new SftpUploadService(workspaceSessionRegistry);
export const archiveService = new ArchiveService(workspaceSessionRegistry);
export const sftpTransferService = new SftpTransferService(workspaceSessionRegistry);
export const statusMonitorService = new WorkspaceStatusMonitorService(workspaceSessionRegistry);
export const auditLogService = new AuditLogService();
export const notificationService = new NotificationService();
export const dockerService = new DockerService();
export { settingsService, workspaceSessionRegistry };
