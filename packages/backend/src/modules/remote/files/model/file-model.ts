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

	async checkFingerprint(resource: FileResource): Promise<void> {
		const current = await this.resolver.fingerprintStored(resource.targetId);
		if (current !== resource.fingerprint) {
			throw new RemoteFileFailure('stale_target');
		}
	}
}
