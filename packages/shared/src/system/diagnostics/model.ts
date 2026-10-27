import type {
	DiagnosticModuleId,
	DiagnosticResourceName,
	DiagnosticResourceUnit,
	DiagnosticResourceStatus,
} from './values.js';

export interface ModuleResourceView {
	id: DiagnosticModuleId;
	status: DiagnosticResourceStatus;
	metrics: { name: DiagnosticResourceName; unit: DiagnosticResourceUnit; value: number }[];
}

export interface HostDiagnosticView {
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
	database: { available: boolean; schemaVersion: number | null };
	modules: ModuleResourceView[];
}
