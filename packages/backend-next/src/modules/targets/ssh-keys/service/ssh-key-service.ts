import { TargetFailure } from '../../target-failure.js';
import { validateTargetId as validateId } from '../../target-validation.js';
import type {
	SshKeyInput,
	SshKeyChanges,
	SshKeyCommandPatch,
	SshKeySnapshot,
	SshKeyMutation,
} from '../model/ssh-key-types.js';
import type { SshKeyModel } from '../model/ssh-key-model.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';

function validateName(value: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TargetFailure('invalid_input');
	}
	return value.trim();
}

export class SshKeyService {
	constructor(
		private readonly model: SshKeyModel,
		private readonly secrets: SecretBox | null,
	) {}

	private requireSecrets(): SecretBox {
		if (!this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		return this.secrets;
	}

	list(): Promise<SshKeySnapshot[]> {
		return this.model.list();
	}

	get(id: number): Promise<SshKeySnapshot | null> {
		validateId(id);
		return this.model.get(id);
	}

	create(data: SshKeyInput): Promise<SshKeySnapshot> {
		if (typeof data.privateKey !== 'string' || !data.privateKey.trim()) {
			throw new TargetFailure('invalid_input');
		}
		const secret = this.requireSecrets();
		return this.model.create({
			name: validateName(data.name),
			encryptedPrivateKey: secret.encrypt(data.privateKey, 'ssh-key:private'),
			encryptedPassphrase: data.passphrase ? secret.encrypt(data.passphrase, 'ssh-key:passphrase') : null,
		});
	}

	update(id: number, version: number, data: SshKeyChanges): Promise<SshKeyMutation> {
		validateId(id);
		validateId(version);
		const patch: SshKeyCommandPatch = {};
		if (data.name !== undefined) {
			patch.name = validateName(data.name);
		}
		if (data.privateKey !== undefined) {
			if (!data.privateKey.trim()) {
				throw new TargetFailure('invalid_input');
			}
			patch.encryptedPrivateKey = this.requireSecrets().encrypt(data.privateKey, 'ssh-key:private');
		}
		if (data.passphrase !== undefined) {
			patch.encryptedPassphrase = data.passphrase
				? this.requireSecrets().encrypt(data.passphrase, 'ssh-key:passphrase')
				: null;
		}
		return this.model.update(id, version, patch);
	}

	delete(id: number): Promise<boolean> {
		validateId(id);
		return this.model.delete(id);
	}
}
