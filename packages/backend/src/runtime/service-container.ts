import { workspaceSessionRegistry } from '../workspace/workspace-session-registry';
import { WorkspaceSftpSessionService } from '../sftp/workspace-sftp-session.service';
import { SftpUploadOperationService } from '../uploads/sftp-upload-operation.service';
import { WorkspaceSftpUploadAdapter } from '../uploads/workspace-sftp-upload.adapter';
import { WorkspaceStatusMonitorService } from '../workspace/workspace-status-monitor.service';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { DockerService } from '../docker/docker.service';
import { settingsService } from '../settings/settings.service';
import { ArchiveOperationService } from '../archive/archive-operation.service';
import { WorkspaceArchiveAdapter } from '../archive/workspace-archive.adapter';
import { SftpTransferOperationService } from '../transfers/sftp-transfer-operation.service';
import { WorkspaceSftpTransferAdapter } from '../transfers/workspace-sftp-transfer.adapter';
import { WorkspaceFilesystemService } from '../workspace/workspace-filesystem.service';

// Application composition root. Protocol modules consume services from here but
// do not own their state or lifecycle.
export const workspaceSftpSessionService = new WorkspaceSftpSessionService(workspaceSessionRegistry);
export const workspaceFilesystemService = new WorkspaceFilesystemService(workspaceSessionRegistry, workspaceSftpSessionService);
export const sftpUploadOperationService = new SftpUploadOperationService();
export const workspaceSftpUploadService = new WorkspaceSftpUploadAdapter(workspaceSessionRegistry, sftpUploadOperationService);
export const archiveOperationService = new ArchiveOperationService();
export const workspaceArchiveService = new WorkspaceArchiveAdapter(workspaceSessionRegistry, archiveOperationService);
export const sftpTransferOperationService = new SftpTransferOperationService();
export const workspaceSftpTransferService = new WorkspaceSftpTransferAdapter(workspaceSessionRegistry, sftpTransferOperationService);
export const statusMonitorService = new WorkspaceStatusMonitorService(workspaceSessionRegistry);
export const auditLogService = new AuditLogService();
export const notificationService = new NotificationService();
export const dockerService = new DockerService();
export { settingsService, workspaceSessionRegistry };
