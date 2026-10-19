import type { ConnectionMetadata } from '../../connections/model/connection-types.js';
import type { ProxyInput } from '../../proxies/model/proxy-types.js';
import type { TargetImportErrorCode } from '@nexus-terminal/shared/targets/connections/values';

/** One application import command; plaintext never enters storage. */
export interface ConnectionImport {
	connection: ConnectionMetadata;
	inlineProxy?: ProxyInput;
	tagNames?: string[];
	credential?: ImportCredential;
}

export type ImportCredential =
	| { kind: 'password'; password: string }
	| { kind: 'ssh_key'; sshKeyId: number }
	| { kind: 'private_key'; name: string; privateKey: string; passphrase: string | null };

export type ImportItemResult = { status: 'ok'; id: number } | { status: 'error'; code: TargetImportErrorCode };
