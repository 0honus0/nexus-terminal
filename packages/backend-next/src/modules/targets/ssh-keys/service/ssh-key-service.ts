import type { SshKeyInput, SshKeyChanges, SshKeyCommandPatch } from '../model/ssh-key-types.js';
import { SshKeyModel } from '../model/ssh-key-model.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';

function id(n: number) {
	if (!Number.isSafeInteger(n) || n <= 0) {
		throw new Error('Invalid ID');
	}
}

function name(n: string) {
	if (typeof n !== 'string' || !n.trim()) {
		throw new Error('Invalid SSH key name');
	}
	return n.trim();
}

export class SshKeyService {
	constructor(
		private readonly model: SshKeyModel,
		private readonly secrets: SecretBox | null,
	) {}

	private crypto() {
		if (!this.secrets) {
			throw new Error('Encryption key required');
		}
		return this.secrets;
	}

	list() {
		return this.model.list();
	}

	get(n: number) {
		id(n);
		return this.model.get(n);
	}

	create(data: SshKeyInput) {
		if (typeof data.privateKey !== 'string' || !data.privateKey.trim()) {
			throw new Error('Invalid SSH private key');
		}
		const secret = this.crypto();
		return this.model.create({
			name: name(data.name),
			encryptedPrivateKey: secret.encrypt(data.privateKey, 'ssh-key:private'),
			encryptedPassphrase: data.passphrase ? secret.encrypt(data.passphrase, 'ssh-key:passphrase') : null,
		});
	}

	update(n: number, v: number, data: SshKeyChanges) {
		id(n);
		id(v);
		const patch: SshKeyCommandPatch = {};
		if (data.name !== undefined) {
			patch.name = name(data.name);
		}
		if (data.privateKey !== undefined) {
			if (!data.privateKey.trim()) {
				throw new Error('Invalid SSH private key');
			}
			patch.encryptedPrivateKey = this.crypto().encrypt(data.privateKey, 'ssh-key:private');
		}
		if (data.passphrase !== undefined) {
			patch.encryptedPassphrase = data.passphrase
				? this.crypto().encrypt(data.passphrase, 'ssh-key:passphrase')
				: null;
		}
		return this.model.update(n, v, patch);
	}

	delete(n: number) {
		id(n);
		return this.model.delete(n);
	}
}
