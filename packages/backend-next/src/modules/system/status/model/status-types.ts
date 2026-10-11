import type { SystemStatusErrorCode } from '@nexus-terminal/shared/system/status/values';

export interface LocalSystemStatus {
	cpuPercent: number;
	memPercent: number;
	memUsed: number;
	memTotal: number;
	diskPercent?: number;
	diskUsed?: number;
	diskTotal?: number;
	cpuModel?: string;
	osName?: string;
	uptimeSeconds: number;
}

export class SystemStatusFailure extends Error {
	constructor(
		readonly code: SystemStatusErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options);
	}
}
