import type { ConnectionRoute, ConnectionTestErrorCode } from './values.js';
import type { TargetHostKeyChallenge } from '../host-keys/model.js';

export interface UnsavedSshTestInput {
	host: string;
	port: number;
	username: string;
	authentication:
		| { kind: 'password'; password: string }
		| { kind: 'ssh_key'; sshKeyId: number }
		| { kind: 'private_key'; privateKey: string; passphrase: string | null };
	route: ConnectionRoute;
	proxyId: number | null;
	jumpIds: number[];
}

/** Success means handshake and local transport cleanup both completed; no command was executed. */
export interface ConnectionTestResponse {
	status: 'ok';
	latencyMs: number;
}

export type ConnectionTestFailureResponse =
	| { code: 'host_key_untrusted'; hostKey: TargetHostKeyChallenge }
	| { code: Exclude<ConnectionTestErrorCode, 'host_key_untrusted'> };
