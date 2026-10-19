import type { WorkspaceConnectResponse } from '@nexus-terminal/shared/remote/workspace/workspace';
import type { WorkspaceConnection } from './workspace-connection-types';

export function toWorkspaceConnection(value: WorkspaceConnectResponse): WorkspaceConnection {
	return {
		workspaceId: value.workspaceId,
		connectionId: value.connectionId,
		connectionName: value.connectionName,
		resumeToken: value.resumeToken,
		attachmentGeneration: value.attachmentGeneration,
		terminalOffset: value.terminalOffset,
		replayedBytes: value.replayedBytes,
		lastConnectedAt: value.lastConnectedAt === undefined ? undefined : value.lastConnectedAt * 1000,
	};
}
