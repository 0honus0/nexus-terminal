import type { TrustedResolvedSshTarget } from '../../../targets/public.js';
import type { MachineConnection } from '../../../../platform/ssh/ssh-port.js';

export interface RemoteMachineOpenRequest {
	targetId: number;
	expectedFingerprint?: string;
	timeoutMs: number;
	signal: AbortSignal;
	/** Recheck the caller's application authority immediately before opening the transport. */
	validate?: () => Promise<void>;
}

export interface OpenedRemoteMachine {
	target: TrustedResolvedSshTarget;
	machine: MachineConnection;
}
