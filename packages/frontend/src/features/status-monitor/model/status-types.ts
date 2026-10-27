import type { ComputedRef, Ref } from 'vue';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';

export interface StatusSample {
	cpuPercent?: number;
	memPercent?: number;
	memUsed?: number;
	memTotal?: number;
	swapPercent?: number;
	swapUsed?: number;
	swapTotal?: number;
	diskPercent?: number;
	diskUsed?: number;
	diskTotal?: number;
	cpuModel?: string;
	netRxRate?: number;
	netTxRate?: number;
	netInterface?: string;
	osName?: string;
	loadAvg?: number[];
	timestamp: number;
}

export interface StatusHistoryPoint {
	time: number;
	value: number;
	sequence: number;
}

export interface StatusHistory {
	cpu: StatusHistoryPoint[];
	memory: StatusHistoryPoint[];
	swap: StatusHistoryPoint[];
	disk: StatusHistoryPoint[];
	networkRx: StatusHistoryPoint[];
	networkTx: StatusHistoryPoint[];
}

export type StatusFailureCode = WorkspaceErrorCode | 'protocol_failure';

export class StatusFailure extends Error {
	constructor(
		readonly code: StatusFailureCode,
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'StatusFailure';
	}
}

export interface StatusMonitorSessionController {
	current: Readonly<Ref<StatusSample | null>>;
	error: Readonly<Ref<StatusFailureCode | null>>;
	history: Readonly<Ref<StatusHistory>>;
	available: ComputedRef<boolean>;
	activate(): void;
	deactivate(): void;
	workspaceConnected(): Promise<void>;
	workspaceDisconnected(): void;
	dispose(): void;
}
