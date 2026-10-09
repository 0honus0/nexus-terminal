import { registerTargets } from '../modules/targets/register.js';
import { registerRemote } from '../modules/remote/register.js';
import { Ssh2MachineFactory } from '../platform/ssh/adapters/ssh2/ssh-machine.js';
import type { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../platform/security/secret-box.js';
import type { MachineConnectOptions } from '../platform/ssh/ssh-port.js';
import type { TargetsPublicApi, TrustedSshTargetResolver } from '../modules/targets/public.js';
import type { RemoteSessions } from '../modules/remote/public.js';
import { registerAccess } from '../modules/access/register.js';
import type { AccessPublicApi } from '../modules/access/public.js';
import type { HttpRoute, HttpWebSocketRoute } from '../platform/http/http-server.js';
import { createTargetsRoutes } from '../modules/targets/interfaces/http/target-http.js';
import { RemoteSessionOwner } from '../modules/remote/sessions/service/session-owner.js';
import { createRemoteHttpRoutes, createRemoteWebSocketRoute } from '../modules/remote/interfaces/http/remote-http.js';
import { registerAgent } from '../modules/agent/register.js';
import { createAgentHttpRoutes } from '../modules/agent/interfaces/http/agent-http.js';
import type { AgentStateApi } from '../modules/agent/public.js';
import type { LoginFailurePolicyOptions } from '../modules/access/authentication/service/login-failure-policy.js';

export interface RegisteredModules {
	access: AccessPublicApi;
	httpRoutes(secureCookies: boolean): HttpRoute[];
	webSocketRoutes(): HttpWebSocketRoute[];
	targets: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
	remote: RemoteSessions;
	agent: AgentStateApi;
	quiesce(): void;
	close(): Promise<void>;
}

/** Only independent business lifecycle owners appear here. */
export function registerModules(
	sqlite: SqliteRuntime,
	secrets: SecretBox | null,
	verifyHostKey: MachineConnectOptions['verifyHostKey'] | null,
	loginFailureOptions?: LoginFailurePolicyOptions,
): RegisteredModules {
	const access = registerAccess(sqlite, loginFailureOptions);
	const targets = registerTargets({ sqlite, secrets });
	const remote = registerRemote({
		resolver: targets.trustedSshTargets,
		ssh: new Ssh2MachineFactory(),
		verifyHostKey,
		hostKeys: targets.publicApi.hostKeys,
	});
	const remoteOwner = new RemoteSessionOwner(access.publicApi, remote.publicApi);
	const agent = registerAgent(sqlite);
	return {
		access: access.publicApi,

		httpRoutes: (secureCookies) => [
			...access.routes(secureCookies),
			...createTargetsRoutes(access.publicApi, targets.publicApi),
			...createRemoteHttpRoutes(remoteOwner, access.publicApi),
			...createAgentHttpRoutes(access.publicApi, agent),
		],

		webSocketRoutes: () => [createRemoteWebSocketRoute(remoteOwner, remote.publicApi)],

		targets: targets.publicApi,
		trustedSshTargets: targets.trustedSshTargets,
		remote: remote.publicApi,
		agent,

		quiesce: () => {
			remoteOwner.quiesce();
			remote.quiesce();
		},

		close: async () => {
			const errors: unknown[] = [];
			try {
				await remoteOwner.close();
			} catch (error) {
				errors.push(error);
			}
			try {
				await remote.close();
			} catch (error) {
				errors.push(error);
			}
			if (errors.length) throw new AggregateError(errors, 'Remote shutdown failed');
		},
	};
}
