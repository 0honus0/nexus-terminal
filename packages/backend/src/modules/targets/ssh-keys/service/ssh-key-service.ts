import {
	TARGET_SSH_PRIVATE_KEY_MAX_BYTES,
	TARGET_SSH_PASSPHRASE_MAX_BYTES,
} from '@nexus-terminal/shared/targets/ssh-keys/values';
import { validateSshKeyName } from '../ssh-key-rules.js';
import { validateTargetId as validateId, validateTargetText } from '../../target-validation.js';
import type { SshKeyInput, SshKeyChanges, SshKeySnapshot, SshKeyMutation } from '../model/ssh-key-types.js';
import type { SshKeyModel } from '../model/ssh-key-model.js';

export class SshKeyService {
	constructor(private readonly model: SshKeyModel) {}

	list(): Promise<SshKeySnapshot[]> {
		return this.model.list();
	}

	get(id: number): Promise<SshKeySnapshot | null> {
		validateId(id);
		return this.model.get(id);
	}

	create(data: SshKeyInput): Promise<SshKeySnapshot> {
		validateTargetText(data.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false);
		if (data.passphrase !== undefined && data.passphrase !== null) {
			validateTargetText(data.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES);
		}
		return this.model.create({
			name: validateSshKeyName(data.name),
			privateKey: data.privateKey,
			passphrase: data.passphrase ?? null,
		});
	}

	update(id: number, version: number, data: SshKeyChanges): Promise<SshKeyMutation> {
		validateId(id);
		validateId(version);
		const patch: SshKeyChanges = {};
		if (data.name !== undefined) {
			patch.name = validateSshKeyName(data.name);
		}
		if (data.privateKey !== undefined) {
			validateTargetText(data.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false);
			patch.privateKey = data.privateKey;
		}
		if (data.passphrase !== undefined) {
			if (data.passphrase !== null) {
				validateTargetText(data.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES);
			}
			patch.passphrase = data.passphrase;
		}
		return this.model.update(id, version, patch);
	}

	delete(id: number): Promise<boolean> {
		validateId(id);
		return this.model.delete(id);
	}
}
