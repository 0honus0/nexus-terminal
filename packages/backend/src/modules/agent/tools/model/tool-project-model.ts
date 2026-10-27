import { agentStorage } from '../../agent-storage-failure.js';
import type { ToolProjectStorage, StoredProjectScope } from '../storage/tool-project-storage.js';
import type { ProjectScope, ProjectBinding, ProjectMutation } from './tool-project-types.js';

function toScope(value: ProjectScope): StoredProjectScope {
	return { userId: value.userId, appId: value.appId, runId: value.runId, connectionId: value.connectionId };
}

export class ToolProjectModel {
	constructor(private readonly owner: ToolProjectStorage) {}

	async get(scope: ProjectScope): Promise<ProjectBinding | null> {
		const value = await agentStorage(() => this.owner.get(toScope(scope)));
		return value
			? { directory: value.directory, targetVersion: value.targetVersion, fingerprint: value.fingerprint }
			: null;
	}

	change(command: ProjectMutation): Promise<boolean> {
		const value = command.binding;
		return agentStorage(() =>
			this.owner.change({
				scope: toScope(command.scope),
				operationId: command.operationId,
				operationHash: command.operationHash,
				policyRevision: command.policyRevision,
				binding: value
					? { directory: value.directory, targetVersion: value.targetVersion, fingerprint: value.fingerprint }
					: null,
			}),
		);
	}
}
