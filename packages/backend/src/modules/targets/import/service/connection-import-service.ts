import { TARGET_CONNECTION_PASSWORD_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import { TargetFailure } from '../../target-failure.js';
import type { ConnectionImport } from '../model/import-types.js';
import type { ConnectionSnapshot } from '../../connections/model/connection-types.js';
import type { ConnectionImportModel } from '../model/import-model.js';
import { validateConnection } from '../../connections/connection-rules.js';
import { validateTagName } from '../../tags/tag-rules.js';
import { validateConnectionTagCount } from '../../connections/connection-rules.js';
import { validateProxyMetadata, validateProxyPassword } from '../../proxies/proxy-rules.js';
import { validateTargetId, validateTargetText } from '../../target-validation.js';
import {
	TARGET_SSH_PRIVATE_KEY_MAX_BYTES,
	TARGET_SSH_PASSPHRASE_MAX_BYTES,
} from '@nexus-terminal/shared/targets/ssh-keys/values';
import { validateSshKeyName } from '../../ssh-keys/ssh-key-rules.js';

export class ConnectionImportService {
	constructor(private readonly model: ConnectionImportModel) {}

	importOne(command: ConnectionImport): Promise<ConnectionSnapshot> {
		const proxy =
			command.inlineProxy === undefined
				? undefined
				: validateProxyMetadata({
						name: command.inlineProxy.name,
						type: command.inlineProxy.type,
						host: command.inlineProxy.host,
						port: command.inlineProxy.port,
						username: command.inlineProxy.username,
					});
		const normalized: ConnectionImport = { connection: validateConnection(command.connection) };
		if (proxy !== undefined) {
			if (normalized.connection.route !== 'proxy' || normalized.connection.proxyId !== null) {
				throw new TargetFailure('invalid_input');
			}
			normalized.inlineProxy = proxy;
			const password = command.inlineProxy?.password;
			if (password !== undefined) {
				if (password === null) {
					throw new TargetFailure('invalid_input');
				}
				normalized.inlineProxy.password = validateProxyPassword(password);
			}
		}
		if (command.tagNames !== undefined) {
			validateConnectionTagCount(command.tagNames.length);
			normalized.tagNames = command.tagNames.map(validateTagName);
		}
		const credential = command.credential;
		if (credential !== undefined) {
			if (credential.kind !== 'password' && normalized.connection.type !== 'SSH') {
				throw new TargetFailure('invalid_input');
			}
			if (credential.kind === 'password') {
				validateTargetText(credential.password, TARGET_CONNECTION_PASSWORD_MAX_BYTES, false);
				normalized.credential = { kind: 'password', password: credential.password };
			} else if (credential.kind === 'ssh_key') {
				validateTargetId(credential.sshKeyId);
				normalized.credential = { kind: 'ssh_key', sshKeyId: credential.sshKeyId };
			} else {
				const name = validateSshKeyName(credential.name);
				validateTargetText(credential.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false);
				if (credential.passphrase !== null) {
					validateTargetText(credential.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES);
				}
				normalized.credential = {
					kind: 'private_key',
					name,
					privateKey: credential.privateKey,
					passphrase: credential.passphrase,
				};
			}
		}
		return this.model.importOne(normalized);
	}
}
