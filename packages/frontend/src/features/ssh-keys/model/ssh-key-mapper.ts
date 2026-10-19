import type { TargetSshKeyView } from '@nexus-terminal/shared/targets/ssh-keys/model';
import type { TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http';
import { readSshKeyInput, readSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http-codec';
import type { SshKeySummary, SshKeyDraft } from './ssh-key-types';

export function toSshKeySummary(value: TargetSshKeyView): SshKeySummary {
	return {
		id: value.id,
		name: value.name,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toSshKeyChanges(value: SshKeyDraft): TargetSshKeyChanges {
	const changes: TargetSshKeyChanges = { name: value.name.trim() };
	if (value.privateKey !== '') {
		changes.privateKey = value.privateKey;
	}
	if (value.clearPassphrase) {
		changes.passphrase = null;
	} else if (value.passphrase !== '') {
		changes.passphrase = value.passphrase;
	}
	return readSshKeyChanges(changes);
}

export function toSshKeyInput(value: SshKeyDraft): TargetSshKeyInput {
	return readSshKeyInput({
		name: value.name.trim(),
		privateKey: value.privateKey,
		passphrase: value.clearPassphrase ? null : value.passphrase || null,
	});
}
