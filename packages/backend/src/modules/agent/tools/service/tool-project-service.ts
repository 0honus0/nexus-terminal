import { posix } from 'node:path';
import { REMOTE_FILE_MAX_PATH_BYTES } from '@nexus-terminal/shared/remote/files/values';
import type { ToolProjectModel } from '../model/tool-project-model.js';
import type { ToolModel } from '../model/tool-model.js';
import type { ProjectInput } from '../model/tool-project-types.js';
import type { ToolProjectValue } from '../model/tool-domain-types.js';
import type { ToolTarget } from '../model/tool-types.js';
import type { HostEffect } from '../model/host-execution-types.js';
import { AgentFailure } from '../../agent-failure.js';

/** Run-local binding facts; guidance traversal and model context assembly belong to the package. */
export class ToolProjectService {
	constructor(
		private readonly bindings: ToolProjectModel,
		private readonly remote: ToolModel,
	) {}

	async perform(
		input: ProjectInput,
		operation: HostEffect,
		target: ToolTarget,
		policyRevision: number,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<ToolProjectValue> {
		const scope = {
			userId: operation.userId,
			appId: operation.appId,
			runId: operation.runId,
			connectionId: target.id,
		};
		signal.throwIfAborted();
		await this.remote.validateTarget(target);
		await validate();
		if (input.action === 'write') {
			if (
				input.directory !== null &&
				(!posix.isAbsolute(input.directory) ||
					posix.normalize(input.directory) !== input.directory ||
					input.directory.includes('\0') ||
					Buffer.byteLength(input.directory, 'utf8') > REMOTE_FILE_MAX_PATH_BYTES)
			) {
				throw new AgentFailure('invalid_input');
			}
			const binding =
				input.directory === null
					? null
					: { directory: input.directory, targetVersion: target.version, fingerprint: target.fingerprint };
			if (
				!(await this.bindings.change({
					scope,
					operationId: operation.id,
					operationHash: operation.operationHash,
					policyRevision,
					binding,
				}))
			) {
				throw new AgentFailure('version_conflict');
			}
			await this.remote.validateTarget(target);
			await validate();
			return { binding: binding === null ? null : { connectionId: target.id, directory: binding.directory } };
		}
		const binding = await this.bindings.get(scope);
		await this.remote.validateTarget(target);
		await validate();
		if (
			binding !== null &&
			(binding.targetVersion !== target.version || binding.fingerprint !== target.fingerprint)
		) {
			throw new AgentFailure('version_conflict');
		}
		return { binding: binding === null ? null : { connectionId: target.id, directory: binding.directory } };
	}
}
