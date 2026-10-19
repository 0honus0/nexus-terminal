import type { MachineCommand } from '../ssh/ssh-port.js';

export interface AcpPermission {
	sessionId: string;
	toolCallId: string;
	title: string | null;
	kind: string | null;
	inputJson: string;
	requestId: string;
}

export interface AcpResult {
	text: string;
	stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';
}

export interface AcpRequest {
	cwd: string;
	prompt: string;
	maxOutputBytes: number;
	clientName: string;
	clientVersion: string;
}

export interface AcpCallbacks {
	signal: AbortSignal;
	permission(
		input: AcpPermission,
		signal: AbortSignal,
	): Promise<{ decision: 'allow_once' | 'reject_once'; delivered(): Promise<void> }>;
}

export class AcpFailure extends Error {
	constructor(
		readonly code:
			'protocol_invalid' | 'limit_exceeded' | 'transport_closed' | 'permission_failed' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super('ACP ' + code, options);
		this.name = 'AcpFailure';
	}
}

export interface AcpPort {
	execute(channel: MachineCommand, request: AcpRequest, callbacks: AcpCallbacks): Promise<AcpResult>;
}
