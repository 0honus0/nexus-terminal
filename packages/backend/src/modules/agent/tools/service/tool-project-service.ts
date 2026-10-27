import { posix } from 'node:path';
import type { ToolProjectModel } from '../model/tool-project-model.js';
import type { ToolModel } from '../model/tool-model.js';
import type { ProjectInput, ProjectGuidance } from '../model/tool-project-types.js';
import type { ToolTarget, ToolOperationScope } from '../model/tool-types.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import { AgentFailure } from '../../agent-failure.js';

/** Bindings are Run-local context, not shell cwd, execution permission or trusted instructions. */
export class ToolProjectService {
	constructor(
		private readonly bindings: ToolProjectModel,
		private readonly remote: ToolModel,
	) {}

	async perform(
		input: ProjectInput,
		operation: ToolOperation,
		target: ToolTarget,
		policyRevision: number,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		const scope = {
			userId: operation.userId,
			appId: operation.appId,
			runId: operation.runId,
			connectionId: target.id,
		};
		await validate();
		if (input.action === 'clear') {
			if (
				!(await this.bindings.change({
					scope,
					operationId: operation.id,
					operationHash: operation.operationHash,
					policyRevision,
					binding: null,
				}))
			) {
				throw new AgentFailure('version_conflict');
			}
			await validate();
			return JSON.stringify({ binding: null, instructions: [] });
		}
		const binding =
			input.action === 'bind'
				? { directory: input.directory, targetVersion: target.version, fingerprint: target.fingerprint }
				: await this.bindings.get(scope);
		await validate();
		if (!binding) {
			return JSON.stringify({ binding: null, instructions: [] });
		}
		if (binding.targetVersion !== target.version || binding.fingerprint !== target.fingerprint) {
			throw new AgentFailure('version_conflict');
		}
		const path = input.action === 'read' ? (input.path ?? binding.directory) : binding.directory;
		const relative = posix.relative(binding.directory, path);
		if (
			relative === '..' ||
			relative.startsWith('../') ||
			posix.isAbsolute(relative) ||
			relative.split('/').filter(Boolean).length > 8
		) {
			throw new AgentFailure('invalid_input');
		}
		const instructions = await this.guidance(binding.directory, path, {
			operationId: operation.id,
			target,
			signal,
			validate,
			timeoutMs: 45000,
		});
		await validate();
		if (
			input.action === 'bind' &&
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
		await validate();
		return JSON.stringify({
			binding: { connectionId: target.id, directory: binding.directory },
			instructions: instructions.map((item) => ({
				path: item.path,
				scopePath: item.scopePath,
				text: item.text,
				sha256: item.sha256,
			})),
		});
	}

	private async guidance(root: string, path: string, scope: ToolOperationScope): Promise<ProjectGuidance[]> {
		const deadline = Date.now() + scope.timeoutMs;

		const request = (): ToolOperationScope => {
			const timeoutMs = deadline - Date.now();
			if (timeoutMs < 1 || scope.signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return {
				operationId: scope.operationId,
				target: scope.target,
				signal: scope.signal,
				validate: scope.validate,
				timeoutMs,
			};
		};

		const directories = [root];
		let current = root;
		for (const segment of posix.relative(root, path).split('/').filter(Boolean)) {
			current = posix.join(current, segment);
			directories.push(current);
		}
		const result: ProjectGuidance[] = [];
		for (const directory of directories) {
			await scope.validate();
			const entries = await this.remote.projectDirectory(directory, request());
			for (const entry of entries
				.filter((entry) => /^agents?\.md$/iu.test(entry.name))
				.sort((a, b) => a.name.localeCompare(b.name))) {
				if (entry.kind !== 'file') {
					throw new AgentFailure('invalid_input');
				}
				if (result.length >= 4 || entry.size > 8192) {
					throw new AgentFailure('limit_exceeded');
				}
				const value = await this.remote.projectInstruction(posix.join(directory, entry.name), request());
				if (value.bytes > 8192) {
					throw new AgentFailure('limit_exceeded');
				}
				result.push({ path: value.path, scopePath: directory, text: value.text, sha256: value.sha256 });
			}
		}
		await scope.validate();
		return result;
	}
}
