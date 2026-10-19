import type { ConnectionData, StoredConnection } from '../../connections/storage/connection-storage.js';
import type { ProxyWrite } from '../../proxies/storage/proxy-storage.js';
import type { SshKeyWrite } from '../../ssh-keys/storage/ssh-key-storage.js';
import type { ConnectionCredentialWrite } from '../../connections/storage/connection-credential-storage.js';

export interface ImportConnectionCommand {
	connection: ConnectionData;
	inlineProxy?: ProxyWrite;
	tagNames?: string[];
	credential?: ConnectionCredentialWrite | { kind: 'private_key'; key: SshKeyWrite };
}

export interface ConnectionImportStorage {
	importOne(command: ImportConnectionCommand): Promise<StoredConnection>;
}
