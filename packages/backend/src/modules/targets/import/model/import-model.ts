import { targetModelFailure, encryptTargetSecret } from '../../model/target-technical-failure.js';
import type { ImportConnectionCommand, ConnectionImportStorage } from '../storage/import-storage.js';
import type { ConnectionImport } from './import-types.js';
import type { ConnectionSnapshot } from '../../connections/model/connection-types.js';
import { fromStorage, toStorage } from '../../connections/model/connection-mapper.js';
import { ConnectionCredentialStorageRefusal } from '../../connections/storage/connection-credential-storage.js';
import { ProxyStorageRefusal } from '../../proxies/storage/proxy-storage.js';
import { TargetFailure } from '../../target-failure.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';

export class ConnectionImportModel {
	constructor(
		private readonly storage: Readonly<ConnectionImportStorage>,
		private readonly secrets: SecretBox | null,
	) {}

	async importOne(command: ConnectionImport): Promise<ConnectionSnapshot> {
		const input: ImportConnectionCommand = { connection: toStorage(command.connection) };
		if (command.inlineProxy !== undefined) {
			const proxy = command.inlineProxy;
			input.inlineProxy = {
				name: proxy.name,
				type: proxy.type,
				host: proxy.host,
				port: proxy.port,
				username: proxy.username,
			};
			if (proxy.password !== undefined && proxy.password !== null) {
				input.inlineProxy.encryptedPassword = encryptTargetSecret(
					this.secrets,
					proxy.password,
					'proxy:password',
				);
			}
		}
		if (command.tagNames !== undefined) {
			input.tagNames = [...command.tagNames];
		}
		const credential = command.credential;
		if (credential?.kind === 'password') {
			input.credential = {
				kind: 'password',
				encryptedPassword: encryptTargetSecret(this.secrets, credential.password, 'connection:password'),
			};
		} else if (credential?.kind === 'ssh_key') {
			input.credential = { kind: 'ssh_key', sshKeyId: credential.sshKeyId };
		} else if (credential?.kind === 'private_key') {
			input.credential = {
				kind: 'private_key',
				key: {
					name: credential.name,
					encryptedPrivateKey: encryptTargetSecret(this.secrets, credential.privateKey, 'ssh-key:private'),
					encryptedPassphrase:
						credential.passphrase === null
							? null
							: encryptTargetSecret(this.secrets, credential.passphrase, 'ssh-key:passphrase'),
				},
			};
		}
		try {
			return fromStorage(await this.storage.importOne(input).catch(targetModelFailure));
		} catch (error) {
			if (error instanceof ProxyStorageRefusal) {
				throw new TargetFailure('conflict', { cause: error });
			}
			if (error instanceof ConnectionCredentialStorageRefusal) {
				throw new TargetFailure('reference_not_found', {
					cause: error,
				});
			}
			throw error;
		}
	}
}
