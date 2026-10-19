import { TARGET_CONNECTION_PASSWORD_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import { TargetFailure } from '../../target-failure.js';
import { validateTargetId, validateTargetText } from '../../target-validation.js';
import type {
	ConnectionCredentialInput,
	CredentialMutation,
	CredentialSnapshot,
} from '../model/connection-credential-types.js';
import type { ConnectionCredentialModel } from '../model/connection-credential-model.js';

export class ConnectionCredentialService {
	constructor(private readonly model: ConnectionCredentialModel) {}

	get(id: number): Promise<CredentialSnapshot | null> {
		validateTargetId(id);
		return this.model.get(id);
	}

	async set(id: number, version: number, input: ConnectionCredentialInput): Promise<CredentialMutation> {
		validateTargetId(id);
		validateTargetId(version);
		if (input.kind === 'ssh_key') {
			validateTargetId(input.sshKeyId);
			return this.model.set(id, version, { kind: 'ssh_key', sshKeyId: input.sshKeyId });
		}
		if (input.kind !== 'password' || !input.password) {
			throw new TargetFailure('invalid_input');
		}
		validateTargetText(input.password, TARGET_CONNECTION_PASSWORD_MAX_BYTES);
		return this.model.set(id, version, {
			kind: 'password',
			password: input.password,
		});
	}

	clear(id: number, version: number): Promise<CredentialMutation> {
		validateTargetId(id);
		validateTargetId(version);
		return this.model.clear(id, version);
	}
}
