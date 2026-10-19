import type { MachineConnection } from '../../../../platform/ssh/ssh-port.js';

export interface RemoteMachineOpenOptions {
	timeoutMs: number;
	signal: AbortSignal;
	/** Recheck the caller's application authority immediately before opening the transport. */
	validate?: () => Promise<void>;
}

export interface RemoteMachineOpenRequest extends RemoteMachineOpenOptions {
	targetId: number;
	expectedFingerprint?: string;
}

export interface RemoteMachineIdentity {
	id: number;
	fingerprint: string;
}

export interface OpenedRemoteMachine {
	target: RemoteMachineIdentity;
	machine: MachineConnection;
	/** Actual pinned handshake key; consumed only by technical conversion Models. */
	hostPublicKey: Uint8Array;
}
