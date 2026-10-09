import type { MachineSshFactory, MachineConnectOptions } from '../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver, HostKeyManagement } from '../targets/public.js';
import { RemoteSessionModel } from './sessions/model/session-model.js';
import { RemoteSessionService } from './sessions/service/session-service.js';
import type { RemoteSessions, SessionView, OpenShellRequest } from './public.js';
import type { OpenSessionRequest, RemoteSessionSnapshot } from './sessions/model/session-types.js';
import type { AccessPublicApi } from '../access/public.js';
import type { HttpRoute, HttpWebSocketRoute } from '../../platform/http/http-server.js';
import { RemoteSessionOwner } from './sessions/service/session-owner.js';
import { createRemoteHttpRoutes, createRemoteWebSocketRoute } from './interfaces/http/remote-http.js';

interface RemoteRegistrationOptions {
	resolver: TrustedSshTargetResolver;
	ssh: MachineSshFactory;
	verifyHostKey: MachineConnectOptions['verifyHostKey'] | null;
	hostKeys: Pick<HostKeyManagement, 'list'>;
	access: AccessPublicApi;
}

interface RemoteRegistration {
	publicApi: RemoteSessions;
	httpRoutes(): HttpRoute[];
	webSocketRoutes(): HttpWebSocketRoute[];
	quiesce(): void;
	close(): Promise<void>;
}

function toSessionView(view: RemoteSessionSnapshot): SessionView {
	return {
		id: view.id,
		targetId: view.targetId,
		fingerprint: view.fingerprint,
		startedAt: view.startedAt,
		status: view.status,
	};
}

function toOpenSessionRequest(input: OpenShellRequest): OpenSessionRequest {
	const result: OpenSessionRequest = {
		targetId: input.targetId,
		columns: input.columns,
		rows: input.rows,
		timeoutMs: input.timeoutMs,
	};
	if (input.term !== undefined) {
		result.term = input.term;
	}
	if (input.signal !== undefined) {
		result.signal = input.signal;
	}
	return result;
}

export function registerRemote(options: RemoteRegistrationOptions): RemoteRegistration {
	const service = new RemoteSessionService(
		new RemoteSessionModel(options.resolver, options.ssh, options.verifyHostKey, options.hostKeys),
	);
	const publicApi: RemoteSessions = {
		open: async (input) => toSessionView(await service.open(toOpenSessionRequest(input))),

		get: (id) => {
			const view = service.get(id);
			return view === null ? null : toSessionView(view);
		},

		list: () => service.list().map(toSessionView),

		write: (id, bytes) => service.write(id, Uint8Array.from(bytes)),

		resize: (id, columns, rows) => service.resize(id, columns, rows),

		onData: (id, listener) => service.onData(id, (bytes) => listener(Uint8Array.from(bytes))),

		onStderr: (id, listener) => service.onStderr(id, (bytes) => listener(Uint8Array.from(bytes))),

		onDrain: (id, listener) => service.onDrain(id, listener),

		onClosed: (id, listener) => service.onClosed(id, listener),

		pauseOutput: (id) => service.pauseOutput(id),

		resumeOutput: (id) => service.resumeOutput(id),

		closeSession: (id) => service.closeSession(id),
	};
	const owner = new RemoteSessionOwner(options.access, publicApi);
	return {
		publicApi,

		httpRoutes: () => createRemoteHttpRoutes(owner, options.access),

		webSocketRoutes: () => [createRemoteWebSocketRoute(owner, publicApi)],

		quiesce: () => {
			owner.quiesce();
			service.quiesce();
		},

		close: async () => {
			const failures: unknown[] = [];
			try {
				await owner.close();
			} catch (error) {
				failures.push(error);
			}
			try {
				await service.close();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw new AggregateError(failures, 'Remote module shutdown failed');
			}
		},
	};
}
