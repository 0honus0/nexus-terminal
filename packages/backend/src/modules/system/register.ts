import type { Logger } from '../../platform/logging/logger.js';
import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { HostDiagnostics } from './public.js';
import { SystemOperationError } from './public-errors.js';
import { DiagnosticService } from './diagnostics/service/diagnostic-service.js';
import { DiagnosticModel } from './diagnostics/model/diagnostic-model.js';
import { SqliteDiagnosticStorage } from './diagnostics/adapters/sqlite/diagnostic-sql.js';
import { NodeProcessDiagnostic } from '../../platform/system/adapters/node-process-diagnostic.js';
import { createDiagnosticRoutes } from './interfaces/http/diagnostic-http.js';
import type { AccessPublicApi } from '../access/public.js';
import { SystemStatusService } from './status/service/status-service.js';
import { SystemStatusModel } from './status/model/status-model.js';
import { NodeLocalSystemStatusAdapter } from '../../platform/system/adapters/node-local-status.js';
import { createSystemStatusRoutes } from './interfaces/http/status-http.js';
import type { HttpRoute } from '../../platform/http/http-types.js';
import type { SnapshotCollector } from '../../platform/storage/sqlite/snapshot-types.js';
import { SealedBytes } from '../../platform/security/sealed-bytes.js';
import { BACKUP_MAX_SNAPSHOT_BYTES } from '@nexus-terminal/shared/system/backups/values';
import { BackupModel } from './backups/model/backup-model.js';
import { BackupService } from './backups/service/backup-service.js';
import { createBackupRoutes } from './interfaces/http/backup-http.js';
import type { SecretBox } from '../../platform/security/secret-box.js';
import type { IncomingMessage } from 'node:http';
import type { ResourceCollector } from '../../platform/system/resource-diagnostic.js';
import type { DiagnosticModuleId } from '@nexus-terminal/shared/system/diagnostics/values';

export interface BackupMaintenance {
	/** false means state/resource outcome is unknown: keep admission stopped. */
	run(request: IncomingMessage, apply: () => Promise<boolean>): Promise<void>;
}

interface SystemRegistration {
	registerResourceCollector(collector: ResourceCollector): void;
	observeDiagnosticRoutes(id: DiagnosticModuleId, routes: readonly HttpRoute[]): HttpRoute[];
	diagnostics: HostDiagnostics;
	httpRoutes(): HttpRoute[];
	quiesce(): void;
	close(): Promise<void>;
	closeForRestore(): Promise<void>;
	maintenanceRoutes(): HttpRoute[];
}

export function registerSystem(
	access: AccessPublicApi,
	sqlite: SqliteRuntime,
	collector: SnapshotCollector,
	secrets: SecretBox | null,
	maintenance: BackupMaintenance,
	logger?: Logger,
): SystemRegistration {
	const backups = new BackupService(
		access,
		new BackupModel(collector, new SealedBytes(BACKUP_MAX_SNAPSHOT_BYTES, secrets)),
		logger,
	);
	const service = new SystemStatusService(access, new SystemStatusModel(new NodeLocalSystemStatusAdapter()));
	const processDiagnostics = new NodeProcessDiagnostic();
	const diagnostic = new DiagnosticService(
		new DiagnosticModel(processDiagnostics, new SqliteDiagnosticStorage(sqlite)),
		access,
	);
	processDiagnostics.register({
		id: 'storage',

		collect: async () => {
			const pendingRequests = sqlite.getPendingRequestCount();
			const pendingOperations = sqlite.getPendingOperationCount();
			const memory = await sqlite.getWorkerMemory();
			return [
				{ name: 'pending_requests', unit: 'count', value: pendingRequests },
				{ name: 'pending_operations', unit: 'count', value: pendingOperations },
				{ name: 'worker_heap_used_bytes', unit: 'bytes', value: memory.heapUsedBytes },
				{ name: 'worker_heap_total_bytes', unit: 'bytes', value: memory.heapTotalBytes },
				{ name: 'worker_external_bytes', unit: 'bytes', value: memory.externalBytes },
				{ name: 'worker_array_buffer_bytes', unit: 'bytes', value: memory.arrayBufferBytes },
			];
		},
	});
	processDiagnostics.register({
		id: 'system',

		collect: () => [{ name: 'pending_requests', unit: 'count', value: diagnostic.getPendingRequestCount() }],
	});
	let closePromise: Promise<void> | null = null;
	return {
		registerResourceCollector: (collector) => processDiagnostics.register(collector),

		observeDiagnosticRoutes: (id, routes) => processDiagnostics.observeHttpRoutes(id, routes),

		diagnostics: {
			collect: async () => {
				let value;
				try {
					value = await diagnostic.collect();
				} catch {
					throw new SystemOperationError('unavailable');
				}
				return {
					collectedAt: value.collectedAt,
					process: {
						uptimeSeconds: value.process.uptimeSeconds,
						residentBytes: value.process.residentBytes,
						heapUsedBytes: value.process.heapUsedBytes,
						runtimeVersion: value.process.runtimeVersion,
						heapTotalBytes: value.process.heapTotalBytes,
						externalBytes: value.process.externalBytes,
						arrayBufferBytes: value.process.arrayBufferBytes,
						cpuUserSeconds: value.process.cpuUserSeconds,
						cpuSystemSeconds: value.process.cpuSystemSeconds,
						gcCount: value.process.gcCount,
						gcDurationSeconds: value.process.gcDurationSeconds,
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
					database: { available: value.database.available, schemaVersion: value.database.schemaVersion },
				};
			},
		},

		httpRoutes: () => [
			...createSystemStatusRoutes(service),
			...createDiagnosticRoutes(diagnostic),
			...createBackupRoutes(backups, (request, apply) => maintenance.run(request, apply)).filter((route) =>
				route.path.endsWith('/export'),
			),
		],

		// The import task must not sit inside the Operations occupancy it needs to drain.
		maintenanceRoutes: () =>
			createBackupRoutes(backups, (request, apply) => maintenance.run(request, apply)).filter((route) =>
				route.path.endsWith('/import'),
			),

		closeForRestore: async () => {
			backups.stopAdmission();
			service.quiesce();
			diagnostic.quiesce();
			const outcomes = await Promise.allSettled([service.close(), diagnostic.close()]);
			processDiagnostics.close();
			const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
			if (failures.length) {
				throw new AggregateError(failures, 'System maintenance drain failed');
			}
		},

		quiesce: () => {
			backups.quiesce();
			service.quiesce();
			diagnostic.quiesce();
		},

		close: () => {
			if (closePromise === null) {
				closePromise = Promise.resolve().then(async () => {
					const results = await Promise.allSettled(
						[service, diagnostic, backups].map((owner) => Promise.resolve().then(() => owner.close())),
					);
					processDiagnostics.close();
					const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
					if (failures.length) {
						throw new AggregateError(failures, 'System owners failed to close');
					}
				});
				service.quiesce();
				diagnostic.quiesce();
				backups.quiesce();
			}
			return closePromise;
		},
	};
}
