import { randomUUID } from 'node:crypto';
import type { ToolJobScope } from './tool-job-types.js';
import type { ToolResourceSnapshot } from './tool-resource-types.js';
import type { TrustedSshTargetResolver, ConnectionCatalog } from '../../../targets/public.js';
import type { HostDiagnostics } from '../../../system/public.js';
import { SystemOperationError } from '../../../system/public-errors.js';
import type { RemoteMachineOperationFactory } from '../../../remote/public.js';
import type { ToolTarget, ToolConnection } from './tool-types.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { AgentFailure, ToolOperationRefusal } from '../../agent-failure.js';
import { ToolRemoteModel } from './tool-remote-model.js';
import { RemoteMachineOperationError } from '../../../remote/public-errors.js';

export class ToolModel {
	private readonly resources = new Map<
		string,
		{
			id: string;
			scope: ToolJobScope;
			openedAt: number;
			lastUsedAt: number;
			active: number;
			closing: boolean;
			cleanupFailed: boolean;
			model: ToolRemoteModel;
		}
	>();

	constructor(
		private readonly targets: ConnectionCatalog,
		private readonly resolver: TrustedSshTargetResolver,
		private readonly operations: RemoteMachineOperationFactory,
		private readonly diagnostics: HostDiagnostics,
		private readonly changed: (scope: ToolJobScope) => void = () => {},
	) {}

	async hostDiagnostics(): Promise<string> {
		try {
			const value = await this.diagnostics.collect();
			return JSON.stringify({
				collectedAt: value.collectedAt,
				process: {
					uptimeSeconds: value.process.uptimeSeconds,
					residentBytes: value.process.residentBytes,
					heapUsedBytes: value.process.heapUsedBytes,
					runtimeVersion: value.process.runtimeVersion,
					heapTotalBytes: value.process.heapTotalBytes,
					externalBytes: value.process.externalBytes,
					arrayBufferBytes: value.process.arrayBufferBytes,
					cpuUserSeconds: value.process.cpuUserSeconds,
					cpuSystemSeconds: value.process.cpuSystemSeconds,
					gcCount: value.process.gcCount,
					gcDurationSeconds: value.process.gcDurationSeconds,
				},
				modules: value.modules.map((module) => ({
					id: module.id,
					status: module.status,
					metrics: module.metrics.map((metric) => ({
						name: metric.name,
						unit: metric.unit,
						value: metric.value,
					})),
				})),
				database: { available: value.database.available, schemaVersion: value.database.schemaVersion },
			});
		} catch (error) {
			if (error instanceof SystemOperationError) {
				throw new ToolOperationRefusal('remote_unavailable', { cause: error });
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async connections(ids: number[]): Promise<ToolConnection[]> {
		try {
			return (await this.targets.listEntries(ids.map((id) => id))).map((entry) => ({
				id: entry.id,
				version: entry.version,
				type: entry.type,
				name: entry.name,
				host: entry.host,
				port: entry.port,
				username: entry.username,
			}));
		} catch (error) {
			if (error instanceof TargetOperationError) {
				throw new AgentFailure(
					error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
					{ cause: error },
				);
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async target(id: number): Promise<ToolTarget> {
		const before = (await this.connections([id]))[0];
		if (!before || before.type !== 'SSH') {
			throw new AgentFailure('not_found');
		}
		try {
			const fingerprint = await this.resolver.fingerprintStored(id);
			const after = (await this.connections([id]))[0];
			if (!after || after.type !== 'SSH' || before.version !== after.version) {
				throw new AgentFailure('version_conflict');
			}
			return { id, version: after.version, fingerprint };
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			if (error instanceof TargetOperationError) {
				const code =
					error.code === 'storage_unavailable'
						? 'storage_unavailable'
						: error.code === 'reference_not_found'
							? 'not_found'
							: error.code === 'unresolvable'
								? 'invalid_input'
								: error.code === 'conflict'
									? 'version_conflict'
									: 'internal_failure';
				throw new AgentFailure(code, { cause: error });
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async validateTarget(target: ToolTarget): Promise<void> {
		const current = await this.target(target.id);
		if (current.version !== target.version || current.fingerprint !== target.fingerprint) {
			throw new AgentFailure('version_conflict');
		}
	}

	remote(scope: ToolJobScope): ToolRemoteModel {
		let entry = this.resources.get(scope.runId);
		if (entry && (entry.scope.userId !== scope.userId || entry.scope.appId !== scope.appId)) {
			throw new AgentFailure('not_found');
		}
		if (!entry) {
			try {
				const ownedScope = { userId: scope.userId, appId: scope.appId, runId: scope.runId };
				entry = {
					id: randomUUID(),
					scope: ownedScope,
					openedAt: Date.now(),
					lastUsedAt: Date.now(),
					active: 0,
					closing: false,
					cleanupFailed: false,
					model: new ToolRemoteModel(this.operations.create(() => this.changed(ownedScope))),
				};
			} catch (error) {
				if (error instanceof RemoteMachineOperationError) {
					throw new ToolOperationRefusal('remote_unavailable', { cause: error });
				}
				throw new AgentFailure('internal_failure', { cause: error });
			}
			this.resources.set(scope.runId, entry);
			this.changed(entry.scope);
		}
		if (entry.closing) {
			throw new AgentFailure('provider_unavailable');
		}
		return entry.model;
	}

	activity(scope: ToolJobScope): () => void {
		this.remote(scope);
		const entry = this.resources.get(scope.runId);
		if (!entry || entry.closing) {
			throw new AgentFailure('provider_unavailable');
		}
		entry.active++;
		entry.lastUsedAt = Date.now();
		this.changed(entry.scope);
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			entry.active--;
			entry.lastUsedAt = Date.now();
			this.changed(entry.scope);
		};
	}

	touch(scope: ToolJobScope): void {
		const entry = this.resources.get(scope.runId);
		if (entry && entry.scope.userId === scope.userId && entry.scope.appId === scope.appId) {
			entry.lastUsedAt = Date.now();
			this.changed(entry.scope);
		}
	}

	scopes(userId: number, appId: string): ToolJobScope[] {
		return [...this.resources.values()]
			.filter((entry) => entry.scope.userId === userId && entry.scope.appId === appId)
			.map((entry) => ({ userId, appId, runId: entry.scope.runId }));
	}

	quiesceRun(scope: ToolJobScope): void {
		const entry = this.resources.get(scope.runId);
		if (entry && entry.scope.userId === scope.userId && entry.scope.appId === scope.appId) {
			entry.closing = true;
			this.changed(entry.scope);
		}
	}

	resource(scope: ToolJobScope): ToolResourceSnapshot | null {
		const entry = this.resources.get(scope.runId);
		if (!entry || entry.scope.userId !== scope.userId || entry.scope.appId !== scope.appId) {
			return null;
		}
		const value = entry.model.snapshot();
		return {
			id: entry.id,
			runId: scope.runId,
			createdAt: entry.openedAt,
			lastUsedAt: entry.lastUsedAt,
			mcpSessions: 0,
			browserSessions: 0,
			phase:
				value.cleanupFailed || entry.cleanupFailed
					? 'cleanup_failed'
					: value.closing || entry.closing
						? 'closing'
						: value.operations > 0 || entry.active > 0
							? 'busy'
							: 'idle',
			connections: value.connections,
			files: value.files,
			operations: Math.max(value.operations, entry.active),
			targets: value.targets.map((id) => id),
		};
	}

	async drainRun(runId: string): Promise<void> {
		const entry = this.resources.get(runId);
		if (entry) {
			await entry.model.close();
		}
	}

	settleDrain(scope: ToolJobScope, failed: boolean): void {
		const entry = this.resources.get(scope.runId);
		if (!entry || entry.scope.userId !== scope.userId || entry.scope.appId !== scope.appId) {
			return;
		}
		if (failed) {
			entry.cleanupFailed = true;
		} else {
			this.resources.delete(scope.runId);
		}
		this.changed(entry.scope);
	}
}
