import { TargetFailure } from '../../target-failure.js';
import { validateTargetId } from '../../target-validation.js';
import { validateUnsavedSshTarget, SSH_RESOLUTION_LIMITS } from '../ssh-target-rules.js';
import type { SshTargetModel } from '../model/ssh-target-model.js';
import type {
	ResolveSshTargetRequest,
	ResolvedSshTarget,
	UnsavedSshTargetInput,
	ResolvedUnsavedSshTarget,
} from '../model/ssh-target-types.js';

export class SshTargetService {
	constructor(private readonly model: SshTargetModel) {}

	fingerprintStored(id: number): Promise<string> {
		validateTargetId(id);
		return this.model.fingerprintStored(id, SSH_RESOLUTION_LIMITS);
	}

	resolveStored(request: ResolveSshTargetRequest): Promise<ResolvedSshTarget> {
		validateTargetId(request.targetId);
		if (request.expectedFingerprint !== undefined && !/^[a-f0-9]{64}$/u.test(request.expectedFingerprint)) {
			throw new TargetFailure('invalid_input');
		}
		return this.model.resolveStored(request, SSH_RESOLUTION_LIMITS);
	}

	resolveUnsaved(request: UnsavedSshTargetInput): Promise<ResolvedUnsavedSshTarget> {
		validateUnsavedSshTarget(request);
		return this.model.resolveUnsaved(request, SSH_RESOLUTION_LIMITS);
	}
}
