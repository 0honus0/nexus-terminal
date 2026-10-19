export interface HostDiagnosticView {
	collectedAt: number;
	process: { uptimeSeconds: number; residentBytes: number; heapUsedBytes: number; runtimeVersion: string };
	database: { available: boolean; schemaVersion: number | null };
}
