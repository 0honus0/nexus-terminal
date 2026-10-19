import type { SYSTEM_HEALTH_STATUS, SYSTEM_SERVICE_NAME } from '@nexus-terminal/shared/system/status/values';

export interface SystemHealth {
	status: typeof SYSTEM_HEALTH_STATUS;
	service: typeof SYSTEM_SERVICE_NAME;
}

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
