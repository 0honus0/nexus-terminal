import { workspaceSessionRegistry } from '../../modules/workspace/workspace-session-registry';
import { WorkspaceSftpSessionService } from '../../modules/workspace/services/workspace-sftp-session.service';
import { SftpUploadOperationService } from '../../platform/operations/upload/sftp-upload-operation.service';
import { WorkspaceSftpUploadAdapter } from '../../modules/workspace/adapters/workspace-sftp-upload.adapter';
import { WorkspaceStatusMonitorService } from '../../modules/workspace/workspace-status-monitor.service';
import { AuditLogService } from '../../modules/audit/audit.service';
import { NotificationService } from '../../modules/notifications/notification.service';
import { DockerService } from '../../platform/docker/docker.service';
import { RemoteDockerService } from '../../platform/docker/remote-docker.service';
import { settingsService } from '../../modules/settings/settings.service';
import { ArchiveOperationService } from '../../platform/operations/archive/archive-operation.service';
import { WorkspaceArchiveAdapter } from '../../modules/workspace/adapters/workspace-archive.adapter';
import { SftpTransferOperationService } from '../../platform/operations/transfer/sftp-transfer-operation.service';
import { WorkspaceSftpTransferAdapter } from '../../modules/workspace/adapters/workspace-sftp-transfer.adapter';
import { WorkspaceFilesystemService } from '../../modules/workspace/workspace-filesystem.service';

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
export const remoteDockerService = new RemoteDockerService();
export { settingsService, workspaceSessionRegistry };
