import type { ObservationErrorCode } from './values.js';

export interface RemoteStatusSample {
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

interface SshResourceStatusMetadata {
	key: string;
	connectionId: number;
	name: string;
	username: string;
	host: string;
	port: number;
	checkedAt: number;
}

export type SshResourceStatus = SshResourceStatusMetadata &
	({ status: RemoteStatusSample; error?: never } | { error: ObservationErrorCode; status?: never });
