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
import type { HttpRoute, HttpWebSocketRoute } from '../platform/http/http-types.js';
import { registerAgent } from '../modules/agent/register.js';
import type { AgentStateApi } from '../modules/agent/public.js';
import type { AccessRegistrationOptions } from '../modules/access/register.js';

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
	loginFailureOptions?: AccessRegistrationOptions['loginFailurePolicy'],
): RegisteredModules {
	const access = registerAccess({ sqlite, loginFailurePolicy: loginFailureOptions });
	const targets = registerTargets({ sqlite, secrets });
	const remote = registerRemote({
		resolver: targets.trustedSshTargets,
		ssh: new Ssh2MachineFactory(),
		verifyHostKey,
		hostKeys: targets.publicApi.hostKeys,
		access: access.publicApi,
	});
	const agent = registerAgent(sqlite);
	return {
		access: access.publicApi,

		httpRoutes: (secureCookies) => [
			...access.routes(secureCookies),
			...targets.routes(access.publicApi),
			...remote.httpRoutes(),
			...agent.routes(access.publicApi),
		],

		webSocketRoutes: remote.webSocketRoutes,

		targets: targets.publicApi,
		trustedSshTargets: targets.trustedSshTargets,
		remote: remote.publicApi,
		agent: agent.publicApi,

		quiesce: () => {
			remote.quiesce();
		},

		close: remote.close,
	};
}
