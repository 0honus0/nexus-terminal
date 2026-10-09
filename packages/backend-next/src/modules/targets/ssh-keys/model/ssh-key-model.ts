import type {
	SshKeyStorage,
	SshKeySummary,
	SshKeyPatch,
	SshKeyMutation as StoredMutation,
} from '../storage/ssh-key-storage.js';
import type { SshKeyCommand, SshKeyCommandPatch, SshKeySnapshot, SshKeyMutation } from './ssh-key-types.js';

function fromStorage(record: SshKeySummary): SshKeySnapshot {
	return {
		id: record.id,
		name: record.name,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function mutation(result: StoredMutation): SshKeyMutation {
	if (result.status === 'updated') return { status: 'updated', value: fromStorage(result.value) };
	if (result.status === 'not_found') return { status: 'not_found' };
	return { status: 'version_conflict' };
}

export class SshKeyModel {
	constructor(private readonly storage: Readonly<SshKeyStorage>) {}

	async list(): Promise<SshKeySnapshot[]> {
		return (await this.storage.list()).map(fromStorage);
	}

	async get(id: number): Promise<SshKeySnapshot | null> {
		const record = await this.storage.get(id);
		return record === null ? null : fromStorage(record);
	}

	async create(data: SshKeyCommand): Promise<SshKeySnapshot> {
		return fromStorage(
			await this.storage.create({
				name: data.name,
				encryptedPrivateKey: data.encryptedPrivateKey,
				encryptedPassphrase: data.encryptedPassphrase,
			}),
		);
	}

	async update(id: number, version: number, data: SshKeyCommandPatch): Promise<SshKeyMutation> {
		const patch: SshKeyPatch = {};
		if (data.name !== undefined) patch.name = data.name;
		if (data.encryptedPrivateKey !== undefined) patch.encryptedPrivateKey = data.encryptedPrivateKey;
		if (data.encryptedPassphrase !== undefined) patch.encryptedPassphrase = data.encryptedPassphrase;
		return mutation(await this.storage.update(id, version, patch));
	}

	delete(id: number) {
		return this.storage.delete(id);
	}
}
