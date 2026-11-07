import { createHash, randomUUID } from 'node:crypto';
import type { AgentPluginServiceTransportFacts } from '@nexus-terminal/shared/agent/plugins/service-transport';
import type {
	AgentPluginServiceTransportRequest,
	AgentPluginServiceTransportResult,
} from '@nexus-terminal/shared/agent/plugins/service-transport';
import type { RemoteProcessChannel } from '../../../remote/public.js';
import { RemoteMachineOperationError } from '../../../remote/public-errors.js';
import { NativeSafeHttpConnection } from '../../../../platform/network/adapters/native-safe-http-stream.js';
import { SafeHttpRequestRefusal } from '../../../../platform/network/safe-http-stream.js';
import type {
	SafeHttpConnection,
	SafeHttpConnectionOptions,
	SafeHttpResponse,
} from '../../../../platform/network/safe-http-stream.js';
import { OperationEffectFailure } from '../../operations/model/operation-failure.js';
import { AgentFailure, AgentResourceFenced, ToolCleanupFailure, ToolExecutionUnknown } from '../../agent-failure.js';

/** This is the existing Node byte-stream high-water mark, well below the 512 KiB JSON envelope after base64. */
const chunkBytes = 64 * 1024;

export interface PluginServicePermissionInput {
	sessionId: string;
	toolCallId: string;
	requestId: string;
	title: string;
	kind: string | null;
	inputJson: string;
}

export interface PluginServicePermissionResponse {
	decision: 'allow_once' | 'reject_once';
	delivered(proof: { sha256: string; sizeBytes: number }): Promise<void>;
	abandon(cause: unknown, dispatched: boolean): Promise<void>;
}

/** Only Host creates this selection, after admission of the exact caller/provider/configuration. */
export type PluginServiceTransportSelection =
	| { kind: 'none' }
	| { kind: 'http'; options: Omit<SafeHttpConnectionOptions, 'signal'> }
	| {
			kind: 'remoteProcess';
			cwd: string;
			run(signal: AbortSignal, consume: (channel: RemoteProcessChannel) => Promise<void>): Promise<void>;
			permission:
				| null
				| ((
						input: PluginServicePermissionInput,
						signal: AbortSignal,
				  ) => Promise<PluginServicePermissionResponse>);
	  };

interface ProcessLease {
	channel: RemoteProcessChannel | null;
	running: Promise<void>;
	release(): void;
	closing: Promise<void> | null;
}

interface PermissionLease {
	channelId: string;
	response: PluginServicePermissionResponse;
	consumed: boolean;
	settled: boolean;
}

/** One execution/provider/configuration owns these bytes; each request revalidates its current caller. */
export class PluginServiceTransportOwner {
	readonly facts: AgentPluginServiceTransportFacts;
	private readonly grant = randomUUID();
	private grantUsed = false;
	private readonly stop = new AbortController();
	private readonly signal: AbortSignal;
	private readonly tasks = new Set<Promise<unknown>>();
	private readonly http = new Map<string, SafeHttpConnection>();
	private readonly responses = new Map<string, SafeHttpResponse>();
	private readonly processes = new Map<string, ProcessLease>();
	private readonly permissions = new Map<string, PermissionLease>();
	private readonly permissionRequests = new Set<string>();
	private readonly failures: unknown[] = [];
	private closePromise: Promise<void> | null = null;
	private readonly abort: () => void;

	constructor(
		private readonly input: {
			signal: AbortSignal;
			/** Bound to the original caller, exact provider instance, current policy/configuration and invocation. */
			validate(): Promise<void>;
			transport: PluginServiceTransportSelection;
		},
		private readonly createHttp: (options: SafeHttpConnectionOptions) => SafeHttpConnection = (options) =>
			new NativeSafeHttpConnection(options),
	) {
		this.signal = AbortSignal.any([input.signal, this.stop.signal]);
		this.facts =
			input.transport.kind === 'none'
				? { kind: 'none' }
				: input.transport.kind === 'http'
					? { kind: 'http', grant: this.grant }
					: { kind: 'remoteProcess', grant: this.grant, cwd: input.transport.cwd };
		// Abort is out-of-band; it never needs a free ordinary Host RPC slot.
		this.abort = () => {
			void this.close().catch(() => undefined);
		};
		input.signal.addEventListener('abort', this.abort, { once: true });
		if (input.signal.aborted) {
			this.abort();
		}
	}

	private async validate(): Promise<void> {
		if (this.closePromise || this.signal.aborted) {
			throw new AgentFailure('forbidden');
		}
		await this.input.validate();
		if (this.closePromise || this.signal.aborted) {
			throw new AgentFailure('forbidden');
		}
	}

	dispatch(request: AgentPluginServiceTransportRequest): Promise<AgentPluginServiceTransportResult> {
		let dispatched = false;
		const task = Promise.resolve()
			.then(async () => {
				await this.validate();
				return this.perform(request, () => {
					dispatched = true;
				});
			})
			.catch((error: unknown) => {
				if (error instanceof SafeHttpRequestRefusal) {
					dispatched = false;
				}
				// HTTP request uncertainty is persisted by its own Operation. The
				// connection can still close successfully; it does not own a remote
				// process whose termination needs a separate confirmation.
				if (dispatched && request.method !== 'transport.http.request') {
					this.failures.push(error);
				}
				if (
					['transport.http.request', 'transport.stdio.open', 'transport.stdio.write'].includes(request.method)
				) {
					throw new OperationEffectFailure(
						error instanceof SafeHttpRequestRefusal
							? 'provider_unavailable'
							: error instanceof AgentFailure
								? error.code
								: 'internal_failure',
						dispatched ? 'unknown' : 'not_started',
						'closed',
						{ cause: error },
					);
				}
				throw error;
			});
		return this.track(task);
	}

	private async perform(
		request: AgentPluginServiceTransportRequest,
		markDispatched: () => void,
	): Promise<AgentPluginServiceTransportResult> {
		switch (request.method) {
			case 'transport.http.open': {
				this.takeGrant(request.params.grant, 'http');
				if (this.input.transport.kind !== 'http') {
					throw new AgentFailure('forbidden');
				}
				const leaseId = randomUUID();
				this.http.set(
					leaseId,
					this.createHttp({
						url: this.input.transport.options.url,
						headers: this.input.transport.options.headers.map((header) => ({
							name: header.name,
							value: header.value,
						})),
						privateAuthorities: this.input.transport.options.privateAuthorities.map(
							(authority) => authority,
						),
						maxResponseBytes: this.input.transport.options.maxResponseBytes,
						signal: this.signal,
					}),
				);
				return { method: request.method, value: { leaseId } };
			}
			case 'transport.http.request': {
				const lease = this.http.get(request.params.leaseId);
				if (!lease) {
					throw new AgentFailure('forbidden');
				}
				markDispatched();
				const response = await lease.request({
					method: request.params.method,
					headers: request.params.headers,
					bodyUtf8: request.params.bodyUtf8,
				});
				if (this.closePromise || this.signal.aborted) {
					await response.close();
					throw new AgentFailure('forbidden');
				}
				const requestId = randomUUID();
				this.responses.set(requestId, response);
				await this.validate();
				return {
					method: request.method,
					value: {
						requestId,
						status: response.status,
						statusText: response.statusText,
						headers: response.headers.map((header) => ({ name: header.name, value: header.value })),
						hasBody: response.hasBody,
					},
				};
			}
			case 'transport.http.read': {
				const response = this.responses.get(request.params.requestId);
				if (!response) {
					throw new AgentFailure('forbidden');
				}
				const value = await response.read(chunkBytes);
				if (value.eof) {
					await response.close();
					this.responses.delete(request.params.requestId);
				}
				if (this.closePromise || this.signal.aborted) {
					return { method: request.method, value: { bytesBase64: '', eof: true } };
				}
				await this.validate();
				return {
					method: request.method,
					value: { bytesBase64: Buffer.from(value.bytes).toString('base64'), eof: value.eof },
				};
			}
			case 'transport.http.cancel': {
				const response = this.responses.get(request.params.requestId);
				if (!response) {
					throw new AgentFailure('forbidden');
				}
				await response.close();
				this.responses.delete(request.params.requestId);
				return { method: request.method, value: null };
			}
			case 'transport.http.close': {
				const lease = this.http.get(request.params.leaseId);
				if (!lease) {
					throw new AgentFailure('forbidden');
				}
				await lease.close();
				this.http.delete(request.params.leaseId);
				return { method: request.method, value: null };
			}
			case 'transport.stdio.open': {
				this.takeGrant(request.params.grant, 'remoteProcess');
				const channelId = await this.openProcess(markDispatched);
				await this.validate();
				return { method: request.method, value: { channelId } };
			}
			case 'transport.stdio.read': {
				const channel = this.channel(request.params.channelId);
				let value: Awaited<ReturnType<RemoteProcessChannel['read']>>;
				try {
					value = await channel.read(request.params.stream, chunkBytes);
				} catch (error) {
					// Closing owns cancellation of these passive reads. Its process lease
					// independently confirms shutdown and preserves any cleanup failure.
					if (this.closePromise || this.signal.aborted) {
						return { method: request.method, value: { bytesBase64: '', eof: true } };
					}
					throw error;
				}
				if (this.closePromise || this.signal.aborted) {
					return { method: request.method, value: { bytesBase64: '', eof: true } };
				}
				await this.validate();
				return {
					method: request.method,
					value: { bytesBase64: Buffer.from(value.bytes).toString('base64'), eof: value.eof },
				};
			}
			case 'transport.stdio.write': {
				const channel = this.channel(request.params.channelId);
				const permission =
					request.params.permissionGrant === null
						? null
						: this.permissions.get(request.params.permissionGrant);
				if (
					request.params.permissionGrant !== null &&
					(!permission || permission.channelId !== request.params.channelId || permission.consumed)
				) {
					throw new AgentFailure('forbidden');
				}
				if (permission) {
					permission.consumed = true;
				}
				const bytes = Buffer.from(request.params.bytesBase64, 'base64');
				if (bytes.toString('base64') !== request.params.bytesBase64) {
					throw new AgentFailure('invalid_input');
				}
				await this.validate();
				markDispatched();
				await channel.write(bytes);
				// Actual write callback/drain has completed; only Host may now acknowledge the durable permission.
				if (permission) {
					await this.validate();
					await permission.response.delivered({
						sha256: createHash('sha256').update(bytes).digest('hex'),
						sizeBytes: bytes.byteLength,
					});
					permission.settled = true;
				}
				return { method: request.method, value: null };
			}
			case 'transport.stdio.end':
				await this.channel(request.params.channelId).end();
				return { method: request.method, value: null };
			case 'transport.stdio.outcome': {
				const value = await this.channel(request.params.channelId).outcome();
				if (value.kind === 'unknown') {
					this.failures.push(new ToolExecutionUnknown());
				}
				return { method: request.method, value };
			}
			case 'transport.stdio.cancel':
				this.channel(request.params.channelId).cancel();
				return { method: request.method, value: null };
			case 'transport.stdio.close': {
				const lease = this.processes.get(request.params.channelId);
				if (!lease) {
					throw new AgentFailure('forbidden');
				}
				await this.closeProcess(lease);
				return { method: request.method, value: null };
			}
			case 'transport.permission.request': {
				this.channel(request.params.channelId);
				if (this.input.transport.kind !== 'remoteProcess' || !this.input.transport.permission) {
					throw new AgentFailure('forbidden');
				}
				const key = JSON.stringify([
					request.params.channelId,
					request.params.sessionId,
					request.params.requestId,
				]);
				if (this.permissionRequests.has(key)) {
					throw new AgentFailure('version_conflict');
				}
				this.permissionRequests.add(key);
				const response = await this.input.transport.permission(
					{
						sessionId: request.params.sessionId,
						toolCallId: request.params.toolCallId,
						requestId: request.params.requestId,
						title: request.params.title,
						kind: request.params.kind,
						inputJson: request.params.inputJson,
					},
					this.signal,
				);
				const grant = randomUUID();
				const lease: PermissionLease = {
					channelId: request.params.channelId,
					response,
					consumed: false,
					settled: false,
				};
				this.permissions.set(grant, lease);
				await this.validate();
				return { method: request.method, value: { decision: response.decision, grant } };
			}
		}
	}

	private takeGrant(grant: string, kind: 'http' | 'remoteProcess'): void {
		if (grant !== this.grant || this.grantUsed || this.input.transport.kind !== kind) {
			throw new AgentFailure('forbidden');
		}
		this.grantUsed = true;
	}

	private async openProcess(markDispatched: () => void): Promise<string> {
		const transport = this.input.transport;
		if (transport.kind !== 'remoteProcess') {
			throw new AgentFailure('forbidden');
		}
		const channelId = randomUUID();
		let release!: () => void;
		const finished = new Promise<void>((resolve) => {
			release = resolve;
		});
		let opened!: () => void;
		let failed!: (cause: unknown) => void;
		const opening = new Promise<void>((resolve, reject) => {
			opened = resolve;
			failed = reject;
		});
		const state: ProcessLease = { channel: null, running: Promise.resolve(), release, closing: null };
		this.processes.set(channelId, state);
		markDispatched();
		state.running = Promise.resolve().then(() =>
			transport.run(this.signal, async (channel) => {
				state.channel = channel;
				opened();
				await finished;
			}),
		);
		void state.running.then(() => {
			if (!state.channel) {
				failed(new ToolExecutionUnknown());
			}
		}, failed);
		await opening;
		return channelId;
	}

	private channel(id: string): RemoteProcessChannel {
		const lease = this.processes.get(id);
		if (!lease?.channel || lease.closing) {
			throw new AgentFailure('forbidden');
		}
		return lease.channel;
	}

	private closeProcess(lease: ProcessLease): Promise<void> {
		if (!lease.closing) {
			lease.closing = Promise.resolve().then(async () => {
				const cleanup: unknown[] = [];
				try {
					await lease.channel?.close();
				} catch (error) {
					cleanup.push(error);
				} finally {
					lease.release();
				}
				try {
					await lease.running;
				} catch (error) {
					if (error instanceof RemoteMachineOperationError && error.code === 'cleanup_failed') {
						cleanup.push(error);
					} else {
						this.failures.push(error);
					}
				}
				if (cleanup.length) {
					throw new ToolCleanupFailure({ cause: new AggregateError(cleanup, 'Process cleanup failed') });
				}
			});
		}
		return lease.closing;
	}

	private track<T>(task: Promise<T>): Promise<T> {
		this.tasks.add(task);
		void task.then(
			() => this.tasks.delete(task),
			() => this.tasks.delete(task),
		);
		return task;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			// Publish the promise before cancellation callbacks can re-enter this owner.
			this.closePromise = Promise.resolve().then(async () => {
				const cleanup: unknown[] = [];
				const resources = await Promise.allSettled([
					...[...this.http.values()].map((lease) => Promise.resolve().then(() => lease.close())),
					...[...this.processes.values()].map((lease) =>
						Promise.resolve().then(() => this.closeProcess(lease)),
					),
				]);
				for (const result of resources) {
					if (result.status === 'rejected') {
						cleanup.push(result.reason);
					}
				}
				await Promise.allSettled([...this.tasks]);
				// Pending opens may have produced resources after the first close snapshot.
				const late = await Promise.allSettled([
					...[...this.responses.values()].map((response) => Promise.resolve().then(() => response.close())),
					...[...this.http.values()].map((lease) => Promise.resolve().then(() => lease.close())),
					...[...this.processes.values()].map((lease) =>
						Promise.resolve().then(() => this.closeProcess(lease)),
					),
				]);
				for (const result of late) {
					if (result.status === 'rejected') {
						cleanup.push(result.reason);
					}
				}
				// A late approval belongs to this same owner even if its request waiter has already failed.
				const permissions = await Promise.allSettled(
					[...this.permissions.values()]
						.filter((lease) => !lease.settled)
						.map(async (lease) => {
							await lease.response.abandon(new ToolExecutionUnknown(), lease.consumed);
							lease.settled = true;
							if (lease.response.decision === 'allow_once' && lease.consumed) {
								this.failures.push(new ToolExecutionUnknown());
							}
						}),
				);
				for (const result of permissions) {
					if (result.status === 'rejected') {
						cleanup.push(result.reason);
					}
				}
				this.input.signal.removeEventListener('abort', this.abort);
				if (cleanup.length) {
					throw new ToolCleanupFailure({
						cause: new AggregateError([...this.failures, ...cleanup], 'Service transport cleanup failed'),
					});
				}
				if (this.failures.length) {
					throw new AgentResourceFenced({
						cause: new AggregateError(this.failures, 'Service transport failed'),
					});
				}
			});
			this.stop.abort();
		}
		return this.closePromise;
	}
}
