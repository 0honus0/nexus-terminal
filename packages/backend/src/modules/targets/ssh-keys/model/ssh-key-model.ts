import { targetModelFailure, encryptTargetSecret } from '../../model/target-technical-failure.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type {
	SshKeyStorage,
	SshKeySummary,
	SshKeyPatch,
	SshKeyMutation as StoredMutation,
} from '../storage/ssh-key-storage.js';
import type { SshKeyInput, SshKeyChanges, SshKeySnapshot, SshKeyMutation } from './ssh-key-types.js';

function fromStorage(record: SshKeySummary): SshKeySnapshot {
	return {
		id: record.id,
		name: record.name,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function toApplicationMutation(result: StoredMutation): SshKeyMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: fromStorage(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export class SshKeyModel {
	constructor(
		private readonly storage: Readonly<SshKeyStorage>,
		private readonly secrets: SecretBox | null,
	) {}

	async list(): Promise<SshKeySnapshot[]> {
		return (await this.storage.list().catch(targetModelFailure)).map(fromStorage);
	}

	async get(id: number): Promise<SshKeySnapshot | null> {
		const record = await this.storage.get(id).catch(targetModelFailure);
		return record === null ? null : fromStorage(record);
	}

	async create(data: SshKeyInput): Promise<SshKeySnapshot> {
		const record = await this.storage
			.create({
				name: data.name,
				encryptedPrivateKey: encryptTargetSecret(this.secrets, data.privateKey, 'ssh-key:private'),
				encryptedPassphrase: data.passphrase
					? encryptTargetSecret(this.secrets, data.passphrase, 'ssh-key:passphrase')
					: null,
			})
			.catch(targetModelFailure);
		return fromStorage(record);
	}

	async update(id: number, version: number, data: SshKeyChanges): Promise<SshKeyMutation> {
		const patch: SshKeyPatch = {};
		if (data.name !== undefined) {
			patch.name = data.name;
		}
		if (data.privateKey !== undefined) {
			patch.encryptedPrivateKey = encryptTargetSecret(this.secrets, data.privateKey, 'ssh-key:private');
		}
		if (data.passphrase !== undefined) {
			patch.encryptedPassphrase = data.passphrase
				? encryptTargetSecret(this.secrets, data.passphrase, 'ssh-key:passphrase')
				: null;
		}
		return toApplicationMutation(await this.storage.update(id, version, patch).catch(targetModelFailure));
	}

	delete(id: number): Promise<boolean> {
		return this.storage.delete(id).catch(targetModelFailure);
	}
}
