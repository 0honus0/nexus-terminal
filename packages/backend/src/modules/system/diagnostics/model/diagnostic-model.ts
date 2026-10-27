import type { ProcessDiagnosticSource } from '../../../../platform/system/process-diagnostic.js';
import type { DiagnosticStorage } from '../storage/diagnostic-storage.js';
import type { HostDiagnostic } from './diagnostic-types.js';
import { SystemCollectionFailure } from '../../system-failure.js';

export class DiagnosticModel {
	constructor(
		private readonly process: ProcessDiagnosticSource,
		private readonly storage: DiagnosticStorage,
	) {}

	async collect(): Promise<HostDiagnostic> {
		const value = await this.collectProcess();
		let schemaVersion: number | null = null;
		try {
			schemaVersion = await this.storage.schemaVersion();
		} catch {
			schemaVersion = null;
		}
		return {
			collectedAt: Date.now(),
			process: {
				uptimeSeconds: value.uptimeSeconds,
				residentBytes: value.residentBytes,
				heapUsedBytes: value.heapUsedBytes,
				runtimeVersion: value.runtimeVersion,
				heapTotalBytes: value.heapTotalBytes,
				externalBytes: value.externalBytes,
				arrayBufferBytes: value.arrayBufferBytes,
				cpuUserSeconds: value.cpuUserSeconds,
				cpuSystemSeconds: value.cpuSystemSeconds,
				gcCount: value.gcCount,
				gcDurationSeconds: value.gcDurationSeconds,
			},
			modules: value.modules.map((module) => ({
				id: module.id,
				status: module.status,
				metrics: module.metrics.map((metric) => ({
					name: metric.name,
					unit: metric.unit,
					value: metric.value,
				})),
			})),
			database: { available: schemaVersion !== null, schemaVersion },
		};
	}

	private async collectProcess(): ReturnType<ProcessDiagnosticSource['collect']> {
		try {
			return await this.process.collect();
		} catch (cause) {
			throw new SystemCollectionFailure({ cause });
		}
	}
}
