import { validateConnectionCredential } from '../connection-rules.js';
import { validateTargetId } from '../../target-validation.js';
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
		validateConnectionCredential(input);
		return this.model.set(id, version, input);
	}

	clear(id: number, version: number): Promise<CredentialMutation> {
		validateTargetId(id);
		validateTargetId(version);
		return this.model.clear(id, version);
	}
}
