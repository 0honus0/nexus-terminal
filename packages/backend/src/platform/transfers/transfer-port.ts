import type { MachineConnection, MachineAuthentication } from '../ssh/ssh-port.js';
import type {
	ServerTransferMethod,
	ServerTransferMethodUsed,
} from '@nexus-terminal/shared/remote/transfers/server-values';

export type NativeTransferReason =
	| 'invalid_endpoint'
	| 'tool_missing'
	| 'host_key_rejected'
	| 'command_failed'
	| 'transport_lost'
	| 'cleanup_unconfirmed';

export class NativeTransferFailure extends Error {
	constructor(
		readonly reason: NativeTransferReason,
		readonly outcome: 'not_started' | 'failed' | 'unknown',
		options?: ErrorOptions,
	) {
		super('Native transfer ' + reason, options);
	}
}

export interface NativeTransferRequest {
	executionId: string;
	source: MachineConnection;
	target: MachineConnection;
	host: string;
	port: number;
	username: string;
	authentication: MachineAuthentication;
	hostKeyFingerprint: string;
	hostPublicKey: Uint8Array;
	sourcePath: string;
	directory: boolean;
	targetDirectory: string;
	method: ServerTransferMethod;
	deadline: number;
	signal: AbortSignal;
	validate(): Promise<void>;
	onMethod(method: ServerTransferMethodUsed): void;
}

export interface NativeTransferPort {
	execute(request: NativeTransferRequest): Promise<ServerTransferMethodUsed>;
}
