import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { MachineSftpLease } from '../../../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { RemoteMachineModel } from '../../model/machine-model.js';
import { RemoteFileFailure, type FileResource } from './file-types.js';
import { SftpFileResource } from './file-resource.js';

export class RemoteFileModel {
	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly resolver: TrustedSshTargetResolver,
	) {}

	async open(targetId: number, timeoutMs: number, signal: AbortSignal): Promise<FileResource> {
		const opened = await this.machines.open({ targetId, timeoutMs, signal });
		let lease: MachineSftpLease | null = null;
		try {
			signal.throwIfAborted();
			lease = await opened.machine.openSftp(signal);
			signal.throwIfAborted();
			return new SftpFileResource(opened.target.id, opened.target.fingerprint, opened.machine, lease);
		} catch (error) {
			const failures: unknown[] = [error];
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
			throw failures.length === 1 ? error : new RemoteResourceCleanupFailure(failures);
		}
	}

	async checkFingerprint(resource: FileResource): Promise<void> {
		const current = await this.resolver.fingerprintStored(resource.targetId);
		if (current !== resource.fingerprint) {
			throw new RemoteFileFailure('stale_target');
		}
	}
}
