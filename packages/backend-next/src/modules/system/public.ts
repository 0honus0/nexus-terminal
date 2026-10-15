export interface HostDiagnostics {
	collect(): Promise<{
		collectedAt: number;
		process: { uptimeSeconds: number; residentBytes: number; heapUsedBytes: number; runtimeVersion: string };
		database: { available: boolean; schemaVersion: number | null };
	}>;
}
