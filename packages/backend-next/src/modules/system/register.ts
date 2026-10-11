import type { AccessPublicApi } from '../access/public.js';
import { SystemStatusService } from './status/service/status-service.js';
import { SystemStatusModel } from './status/model/status-model.js';
import { NodeLocalSystemStatusAdapter } from '../../platform/system/adapters/node-local-status.js';
import { createSystemStatusRoutes } from './interfaces/http/status-http.js';
import type { HttpRoute } from '../../platform/http/http-types.js';
interface SystemRegistration {
	httpRoutes(): HttpRoute[];
	quiesce(): void;
	close(): Promise<void>;
}

export function registerSystem(access: AccessPublicApi): SystemRegistration {
	const service = new SystemStatusService(access, new SystemStatusModel(new NodeLocalSystemStatusAdapter()));
	return {
		httpRoutes: () => createSystemStatusRoutes(service),

		quiesce: () => service.quiesce(),

		close: () => service.close(),
	};
}
