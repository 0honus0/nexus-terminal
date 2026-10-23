import type {
	DiagnosticModuleId,
	DiagnosticResourceName,
	DiagnosticResourceUnit,
	DiagnosticResourceStatus,
} from '@nexus-terminal/shared/system/diagnostics/values';

export interface HostDiagnostic {
	collectedAt: number;
	process: {
		uptimeSeconds: number;
		residentBytes: number;
		heapUsedBytes: number;
		runtimeVersion: string;
		heapTotalBytes: number;
		externalBytes: number;
		arrayBufferBytes: number;
		cpuUserSeconds: number;
		cpuSystemSeconds: number;
		gcCount: number;
		gcDurationSeconds: number;
	};
	modules: {
		id: DiagnosticModuleId;
		status: DiagnosticResourceStatus;
		metrics: { name: DiagnosticResourceName; unit: DiagnosticResourceUnit; value: number }[];
	}[];
	database: { available: boolean; schemaVersion: number | null };
}
