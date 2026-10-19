import {
	TARGET_CONNECTION_HOST_MAX_BYTES,
	TARGET_CONNECTION_MAX_JUMPS,
	TARGET_CONNECTION_USERNAME_MAX_BYTES,
	TARGET_CONNECTION_PASSWORD_MAX_BYTES,
} from '@nexus-terminal/shared/targets/connections/values';
import { TargetFailure } from '../target-failure.js';
import { validateTargetId, validateTargetText } from '../target-validation.js';
import { SSH_MAX_JUMP_EDGES, SSH_MAX_EXPANDED_TARGETS } from '../ssh-graph-limits.js';
import type { SshResolutionLimits } from './model/ssh-target-types.js';
import {
	TARGET_SSH_PRIVATE_KEY_MAX_BYTES,
	TARGET_SSH_PASSPHRASE_MAX_BYTES,
} from '@nexus-terminal/shared/targets/ssh-keys/values';
import type { UnsavedSshTargetInput } from './model/ssh-target-types.js';

export const SSH_RESOLUTION_LIMITS: Readonly<SshResolutionLimits> = {
	maxJumpEdges: SSH_MAX_JUMP_EDGES,
	maxExpandedTargets: SSH_MAX_EXPANDED_TARGETS,
};

export function validateUnsavedSshTarget(request: UnsavedSshTargetInput): void {
	validateTargetText(request.host, TARGET_CONNECTION_HOST_MAX_BYTES, false);
	validateTargetText(request.username, TARGET_CONNECTION_USERNAME_MAX_BYTES, false);
	if (
		!Number.isSafeInteger(request.port) ||
		request.port < 1 ||
		request.port > 65535 ||
		request.jumpIds.length > TARGET_CONNECTION_MAX_JUMPS ||
		new Set(request.jumpIds).size !== request.jumpIds.length ||
		!['direct', 'proxy', 'jump'].includes(request.route) ||
		(request.route === 'proxy' ? request.proxyId === null : request.proxyId !== null) ||
		(request.route === 'jump' ? !request.jumpIds.length : request.jumpIds.length !== 0)
	) {
		throw new TargetFailure('invalid_input');
	}
	request.jumpIds.forEach(validateTargetId);
	if (request.proxyId !== null) {
		validateTargetId(request.proxyId);
	}
	const auth = request.authentication;
	if (auth.kind === 'ssh_key') {
		validateTargetId(auth.sshKeyId);
	} else if (auth.kind === 'password') {
		validateTargetText(auth.password, TARGET_CONNECTION_PASSWORD_MAX_BYTES);
	} else {
		validateTargetText(auth.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false);
		if (auth.passphrase !== null) {
			validateTargetText(auth.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES);
		}
	}
}
