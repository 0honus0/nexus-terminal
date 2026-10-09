import type { MachineSshFactory, MachineConnectOptions } from '../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver } from '../targets/public.js';
import { RemoteSessionService } from './sessions/service/session-service.js';
import type { RemoteSessions, SessionView, OpenShellRequest } from './public.js';

function sessionView(view: {
	id: string;
	targetId: number;
	fingerprint: string;
	startedAt: number;
	status: 'open' | 'closed';
}): SessionView {
	return {
		id: view.id,
		targetId: view.targetId,
		fingerprint: view.fingerprint,
		startedAt: view.startedAt,
		status: view.status,
	};
}

function openInput(input: OpenShellRequest): OpenShellRequest {
	const result: OpenShellRequest = {
		targetId: input.targetId,
		columns: input.columns,
		rows: input.rows,
		timeoutMs: input.timeoutMs,
	};
	if (input.term !== undefined) result.term = input.term;
	if (input.signal !== undefined) result.signal = input.signal;
	return result;
}

export function registerRemote(options: {
	resolver: TrustedSshTargetResolver;
	ssh: MachineSshFactory;
	verifyHostKey: MachineConnectOptions['verifyHostKey'] | null;
}): {
	publicApi: RemoteSessions;
	quiesce(): void;
	close(): Promise<void>;
} {
	const service = new RemoteSessionService(options.resolver, options.ssh, options.verifyHostKey);
	const publicApi: RemoteSessions = {
		open: async (input) => sessionView(await service.open(openInput(input))),

		get: (id) => {
			const view = service.get(id);
			return view === null ? null : sessionView(view);
		},

		list: () => service.list().map(sessionView),

		write: (id, bytes) => service.write(id, Uint8Array.from(bytes)),

		resize: (id, columns, rows) => service.resize(id, columns, rows),

		onData: (id, listener) => service.onData(id, (bytes) => listener(Uint8Array.from(bytes))),

		onStderr: (id, listener) => service.onStderr(id, (bytes) => listener(Uint8Array.from(bytes))),

		onDrain: (id, listener) => service.onDrain(id, listener),

		onClosed: (id, listener) => service.onClosed(id, listener),

		closeSession: (id) => service.closeSession(id),
	};
	return {
		publicApi,

		quiesce: () => service.quiesce(),

		close: () => service.close(),
	};
}
