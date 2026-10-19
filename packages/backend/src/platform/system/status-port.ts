import type { MachineCommandExecutor } from '../ssh/ssh-port.js';

export interface MachineStatus {
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

export interface MachineStatusCollector {
	collect(execute: MachineCommandExecutor, key: string, signal: AbortSignal): Promise<MachineStatus>;
	clear(key: string): void;
}

export class StatusCollectionFailure extends Error {
	constructor(options?: ErrorOptions) {
		super('Machine status unavailable', options);
	}
}
