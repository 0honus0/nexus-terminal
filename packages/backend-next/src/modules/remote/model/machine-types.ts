import type { TrustedResolvedSshTarget } from '../../targets/public.js';
import type { MachineConnection } from '../../../platform/ssh/ssh-port.js';

export interface RemoteMachineOpenRequest {
	targetId: number;
	expectedFingerprint?: string;
	timeoutMs: number;
	signal: AbortSignal;
}

export interface OpenedRemoteMachine {
	target: TrustedResolvedSshTarget;
	machine: MachineConnection;
}
