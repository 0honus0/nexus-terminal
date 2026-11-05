import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { RemoteMachineOperationService } from './operation-service.js';

export class RemoteMachineOperationFactoryService {
	private readonly scopes = new Set<RemoteMachineOperationService>();
	private closing = false;
	private closePromise: Promise<void> | null = null;

	constructor(private readonly createScope: (changed: () => void) => RemoteMachineOperationService) {}

	create(changed: () => void): RemoteMachineOperationService {
		if (this.closing) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		const scope = this.createScope(changed);
		this.scopes.add(scope);
		return scope;
	}

	async release(scope: RemoteMachineOperationService): Promise<void> {
		await scope.close();
		this.scopes.delete(scope);
	}

	quiesce(): void {
		this.closing = true;
		for (const scope of this.scopes) {
			scope.quiesce();
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				const results = await Promise.allSettled([...this.scopes].map((scope) => this.release(scope)));
				const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
				if (failures.length) {
					throw new RemoteResourceCleanupFailure(failures);
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}
