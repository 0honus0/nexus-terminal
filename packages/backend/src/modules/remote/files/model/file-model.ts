import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ServerTransferModel } from '../../transfers/model/server-transfer-model.js';
import type { ServerTransferCommand } from '../../transfers/model/server-transfer-types.js';
import { ServerTransferFailure } from '../../transfers/model/server-transfer-types.js';
import type { FileDirectCopyRequest } from './file-task-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { timingSafeEqual } from 'node:crypto';
import type { MachineSftpLease } from '../../../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { RemoteMachineModel } from '../../machines/model/machine-model.js';
import { RemoteFileFailure, type FileResource } from './file-types.js';
import { SftpFileResource } from './file-resource.js';

export class RemoteFileModel {
	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly resolver: TrustedSshTargetResolver,
		private readonly tokens: SessionTokens,
		private readonly transfers: ServerTransferModel,
	) {}

	private failure(cause: unknown): Error {
		if (
			cause instanceof RemoteFileFailure ||
			cause instanceof RemoteResourceCleanupFailure ||
			cause instanceof RemoteHostKeyUntrustedError ||
			cause instanceof TargetOperationError
		) {
			return cause;
		}
		return new RemoteFileFailure('remote_unavailable', { cause });
	}

	issueToken(): string {
		try {
			return this.tokens.issue();
		} catch (cause) {
			throw new RemoteFileFailure('remote_unavailable', { cause });
		}
	}

	digestToken(token: string): string {
		try {
			return this.tokens.digest(token);
		} catch (cause) {
			throw new RemoteFileFailure('remote_unavailable', { cause });
		}
	}

	matchesToken(token: string, expected: string): boolean {
		const actual = Buffer.from(this.digestToken(token), 'hex');
		const digest = Buffer.from(expected, 'hex');
		return actual.length === digest.length && timingSafeEqual(actual, digest);
	}

	async open(
		targetId: number,
		timeoutMs: number,
		signal: AbortSignal,
		expectedFingerprint?: string,
		validate?: () => Promise<void>,
	): Promise<FileResource> {
		const opened = await this.machines
			.open({ targetId, timeoutMs, signal, expectedFingerprint, validate })
			.catch((cause: unknown) => {
				throw this.failure(cause);
			});
		let lease: MachineSftpLease | null = null;
		try {
			signal.throwIfAborted();
			lease = await opened.machine.openSftp(signal);
			signal.throwIfAborted();
			return new SftpFileResource(opened.target.id, opened.target.fingerprint, opened.machine, lease);
		} catch (error) {
			const failure = this.failure(error);
			const failures: unknown[] = [failure];
			if (lease) {
				try {
					await lease.close();
				} catch (closeError) {
					failures.push(closeError);
				}
			}
			try {
				await opened.machine.close();
			} catch (closeError) {
				failures.push(closeError);
			}
			throw failures.length === 1 ? failure : new RemoteResourceCleanupFailure(failures);
		}
	}

	async copyDirect(input: FileDirectCopyRequest): Promise<boolean> {
		try {
			await input.validate();
			const command: ServerTransferCommand = {
				sourceConnectionId: input.sourceTargetId,
				connectionIds: [input.targetId],
				sourceItems: [
					{
						name: path.posix.basename(input.sourcePath),
						path: input.sourcePath,
						type: input.directory ? 'directory' : 'file',
					},
				],
				remoteTargetPath: input.destinationDirectory,
				transferMethod: input.method,
			};
			const plan = await this.transfers.prepare(command);
			if (
				plan.source.fingerprint !== input.sourceFingerprint ||
				plan.targets[0]?.fingerprint !== input.targetFingerprint
			) {
				throw new RemoteFileFailure('stale_target');
			}
			if (plan.targets.some((target) => !target.direct)) {
				return false;
			}
			if (plan.resources[0] === plan.resources[1]) {
				const destination = path.posix.join(input.destinationDirectory, path.posix.basename(input.sourcePath));
				if (
					destination === input.sourcePath ||
					destination.startsWith(input.sourcePath + '/') ||
					input.sourcePath.startsWith(destination + '/')
				) {
					if (destination === input.sourcePath && input.mode === 'copy') {
						return false;
					}
					throw new RemoteFileFailure('conflict');
				}
			}
			await this.transfers.execute({
				executionId: randomUUID(),
				command,
				plan,
				targetId: input.targetId,
				sourceIndex: 0,
				deadline: input.deadline,
				signal: input.signal,

				validate: async () => {
					await input.validate();
					await this.transfers.validate(plan);
				},

				onMethod: (method) => input.onMethod(method),

				onProgress: (bytes, percent) => input.onProgress(bytes, percent),

				onMutation: () => input.onMutation(),
			});
			return true;
		} catch (cause) {
			if (cause instanceof ServerTransferFailure) {
				if (
					cause.outcome === 'not_started' &&
					[
						'tool_unavailable',
						'unsupported_endpoint',
						'unsupported_target_route',
						'connection_failed',
					].includes(cause.code)
				) {
					return false;
				}
				const code =
					cause.outcome === 'unknown'
						? 'operation_unknown'
						: cause.code === 'host_key_untrusted'
							? 'host_key_untrusted'
							: cause.code === 'stale_target'
								? 'stale_target'
								: cause.code === 'not_found'
									? 'not_found'
									: 'remote_unavailable';
				throw new RemoteFileFailure(code, { cause });
			}
			throw this.failure(cause);
		}
	}

	async checkFingerprint(resource: FileResource): Promise<void> {
		const current = await this.resolver.fingerprintStored(resource.targetId);
		if (current !== resource.fingerprint) {
			throw new RemoteFileFailure('stale_target');
		}
	}
}
