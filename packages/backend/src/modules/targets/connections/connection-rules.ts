import {
	TARGET_CONNECTION_NAME_MAX_BYTES,
	TARGET_CONNECTION_MAX_TAGS,
	TARGET_CONNECTION_MAX_JUMPS,
	TARGET_CONNECTION_HOST_MAX_BYTES,
	TARGET_CONNECTION_USERNAME_MAX_BYTES,
	TARGET_CONNECTION_NOTES_MAX_BYTES,
	TARGET_RDP_REMOTE_APP_MAX_BYTES,
	TARGET_RDP_REMOTE_APP_DIRECTORY_MAX_BYTES,
	TARGET_RDP_REMOTE_APP_ARGUMENTS_MAX_BYTES,
} from '@nexus-terminal/shared/targets/connections/values';
import type { CredentialAssignment } from './model/connection-credential-types.js';
import { TargetFailure } from '../target-failure.js';
import type { ConnectionMetadata, ConnectionTypeChange } from './model/connection-types.js';
import { validateTargetId, validateTargetText } from '../target-validation.js';

export function validateConnectionTagCount(count: number): void {
	if (!Number.isSafeInteger(count) || count < 0 || count > TARGET_CONNECTION_MAX_TAGS) {
		throw new TargetFailure('invalid_input');
	}
}

export function validateConnection(data: ConnectionMetadata): ConnectionMetadata {
	validateTargetText(data.name, TARGET_CONNECTION_NAME_MAX_BYTES, false);
	validateTargetText(data.host, TARGET_CONNECTION_HOST_MAX_BYTES, false);
	validateTargetText(data.username, TARGET_CONNECTION_USERNAME_MAX_BYTES);
	if (data.notes !== null) {
		validateTargetText(data.notes, TARGET_CONNECTION_NOTES_MAX_BYTES);
	}
	if (data.rdpRemoteApp !== null) {
		validateTargetText(data.rdpRemoteApp, TARGET_RDP_REMOTE_APP_MAX_BYTES, false);
	}
	if (data.rdpRemoteAppDirectory !== null) {
		validateTargetText(data.rdpRemoteAppDirectory, TARGET_RDP_REMOTE_APP_DIRECTORY_MAX_BYTES);
	}
	if (data.rdpRemoteAppArguments !== null) {
		validateTargetText(data.rdpRemoteAppArguments, TARGET_RDP_REMOTE_APP_ARGUMENTS_MAX_BYTES);
	}
	validateConnectionTagCount(data.tagIds.length);
	if (
		data.jumpIds.length > TARGET_CONNECTION_MAX_JUMPS ||
		!Number.isInteger(data.port) ||
		data.port < 1 ||
		data.port > 65535
	) {
		throw new TargetFailure('invalid_input');
	}
	if (!['SSH', 'RDP', 'VNC'].includes(data.type) || !['direct', 'proxy', 'jump'].includes(data.route)) {
		throw new TargetFailure('invalid_input');
	}
	if (
		(data.type !== 'RDP' &&
			(data.rdpRemoteApp !== null ||
				data.rdpRemoteAppDirectory !== null ||
				data.rdpRemoteAppArguments !== null)) ||
		(data.type === 'RDP' &&
			data.rdpRemoteApp === null &&
			(data.rdpRemoteAppDirectory !== null || data.rdpRemoteAppArguments !== null))
	) {
		throw new TargetFailure('invalid_input');
	}
	for (const id of [...data.tagIds, ...data.jumpIds]) {
		validateTargetId(id);
	}
	if (data.proxyId !== null) {
		validateTargetId(data.proxyId);
	}
	return {
		...data,
		name: data.name.trim(),
		host: data.host.trim(),
		tagIds: [...data.tagIds],
		jumpIds: [...data.jumpIds],
	};
}

export function normalizeConnectionChanges(
	current: ConnectionMetadata,
	changes: Partial<ConnectionMetadata>,
): Partial<ConnectionMetadata> {
	const normalized = validateConnection({ ...current, ...changes });
	const patch: Partial<ConnectionMetadata> = {};
	if (changes.name !== undefined) {
		patch.name = normalized.name;
	}
	if (changes.type !== undefined) {
		patch.type = normalized.type;
	}
	if (changes.host !== undefined) {
		patch.host = normalized.host;
	}
	if (changes.port !== undefined) {
		patch.port = normalized.port;
	}
	if (changes.username !== undefined) {
		patch.username = normalized.username;
	}
	if (changes.route !== undefined) {
		patch.route = normalized.route;
	}
	if (changes.proxyId !== undefined) {
		patch.proxyId = normalized.proxyId;
	}
	if (changes.notes !== undefined) {
		patch.notes = normalized.notes;
	}
	if (changes.rdpRemoteApp !== undefined) {
		patch.rdpRemoteApp = normalized.rdpRemoteApp;
	}
	if (changes.rdpRemoteAppDirectory !== undefined) {
		patch.rdpRemoteAppDirectory = normalized.rdpRemoteAppDirectory;
	}
	if (changes.rdpRemoteAppArguments !== undefined) {
		patch.rdpRemoteAppArguments = normalized.rdpRemoteAppArguments;
	}
	if (changes.tagIds !== undefined) {
		patch.tagIds = normalized.tagIds;
	}
	if (changes.jumpIds !== undefined) {
		patch.jumpIds = normalized.jumpIds;
	}
	return patch;
}

export function validateConnectionTypeChange(facts: ConnectionTypeChange): void {
	if (facts.previousType === 'SSH' && facts.nextType !== 'SSH' && (facts.hasCredential || facts.isJumpTarget)) {
		throw new TargetFailure('reference_in_use');
	}
}

export function validateCredentialAssignment(command: CredentialAssignment): void {
	if (command.connectionType !== 'SSH' && command.kind === 'ssh_key') {
		throw new TargetFailure('invalid_input');
	}
}
