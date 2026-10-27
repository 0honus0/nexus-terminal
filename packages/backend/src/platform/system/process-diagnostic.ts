import type { ModuleResourceDiagnostic } from './resource-diagnostic.js';

export interface ProcessDiagnostic {
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
	modules: ModuleResourceDiagnostic[];
}

export interface ProcessDiagnosticSource {
	collect(): Promise<ProcessDiagnostic>;
}
