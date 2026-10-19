import { registerOperationsSnapshot } from './snapshots/adapters/sqlite/snapshot-registration.js';
import type { SnapshotRegistration } from '../../platform/storage/sqlite/snapshot-types.js';
import { AuditEventOwner } from './audit/service/audit-event-owner.js';
import { observeOperationRoutes } from './interfaces/http/operation-observer.js';

import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import type { SecretBox } from '../../platform/security/secret-box.js';
import type { HttpRoute } from '../../platform/http/http-types.js';
import type { AccessPublicApi } from '../access/public.js';
import type { OperationsEvents } from './public.js';
import { NativeLogger } from '../../platform/logging/native-logger.js';
import { NativeDelivery } from '../../platform/delivery/adapters/native-delivery.js';
import { SecureSessionTokens } from '../../platform/security/adapters/secure-session-tokens.js';
import { SqliteAuditStorage } from './audit/adapters/sqlite/audit-sql.js';
import { AuditModel } from './audit/model/audit-model.js';
import { AuditService } from './audit/service/audit-service.js';
import { SqliteLoggingStorage } from './logging/adapters/sqlite/logging-sql.js';
import { LoggingModel } from './logging/model/logging-model.js';
import { LoggingService } from './logging/service/logging-service.js';
import { SqliteNotificationStorage } from './notifications/adapters/sqlite/notification-sql.js';
import { NotificationModel } from './notifications/model/notification-model.js';
import { NotificationService } from './notifications/service/notification-service.js';
import { createOperationsRoutes } from './interfaces/http/operations-http.js';
import { OperationsFailure } from './operations-failure.js';
import { OperationsError } from './public-errors.js';

export interface OperationsRegistration {
	publicApi: OperationsEvents;
	observe(routes: readonly HttpRoute[]): HttpRoute[];
	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void;
	initialize(mode: 'startup' | 'restore'): Promise<void>;
	routes(access: AccessPublicApi): HttpRoute[];
	quiesce(): void;
	close(): Promise<void>;
}

export function registerOperations(sqlite: SqliteRuntime, secrets: SecretBox | null): OperationsRegistration {
	const loggingStorage = new SqliteLoggingStorage(sqlite);
	const notificationStorage = new SqliteNotificationStorage(sqlite);
	const logging = new LoggingService(new LoggingModel(loggingStorage, new SecureSessionTokens(), new NativeLogger()));
	const audit = new AuditService(new AuditModel(new SqliteAuditStorage(sqlite)));
	const notifications = new NotificationService(
		new NotificationModel(notificationStorage, secrets, new SecureSessionTokens(), new NativeDelivery()),
	);
	const owner = new AuditEventOwner(audit, logging, notifications);
	const publicApi: OperationsEvents = {
		publish: async (notice) => {
			try {
				await owner.publish({
					key: notice.key,
					event: notice.event,
					userId: notice.userId,
					subjectId: notice.subjectId,
					sourceIp: notice.sourceIp,
					route: notice.route,
					statusCode: notice.statusCode,
				});
			} catch (error) {
				throw new OperationsError(error instanceof OperationsFailure ? error.code : 'internal_failure');
			}
		},
	};
	return {
		publicApi,

		observe: (routes) =>
			observeOperationRoutes(
				routes,
				(notice) => owner.publish(notice),
				(work) => owner.run(work),
			),

		installTransactionIdentityReader: (read) => {
			loggingStorage.installTransactionIdentityReader(read);
			notificationStorage.installTransactionIdentityReader(read);
		},

		initialize: (mode) => owner.initialize(mode),

		routes: (access) => createOperationsRoutes(audit, logging, notifications, access),

		quiesce: () => owner.quiesce(),

		close: () => owner.close(),
	};
}

/** Installation-only fixed storage coverage; no business records leave the adapter. */
export function registerOperationsBackup(secrets: SecretBox | null): SnapshotRegistration {
	return registerOperationsSnapshot(secrets);
}
