import { registerTargets } from '../modules/targets/register.js';
import { registerRemote } from '../modules/remote/register.js';
import { Ssh2MachineFactory } from '../platform/ssh/adapters/ssh2/ssh-machine.js';
import type { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../platform/security/secret-box.js';
import type { MachineConnectOptions } from '../platform/ssh/ssh-port.js';
import type { TargetsPublicApi, TrustedSshTargetResolver } from '../modules/targets/public.js';
import type { RemoteSessions } from '../modules/remote/public.js';

export interface RegisteredModules {
	targets: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
	remote: RemoteSessions;
	quiesce(): void;
	close(): Promise<void>;
}

/** Only independent business lifecycle owners appear here. */
export function registerModules(
	sqlite: SqliteRuntime,
	secrets: SecretBox | null,
	verifyHostKey: MachineConnectOptions['verifyHostKey'] | null,
): RegisteredModules {
	const targets = registerTargets({ sqlite, secrets });
	const remote = registerRemote({
		resolver: targets.trustedSshTargets,
		ssh: new Ssh2MachineFactory(),
		verifyHostKey,
	});
	return {
		targets: targets.publicApi,
		trustedSshTargets: targets.trustedSshTargets,
		remote: remote.publicApi,
		quiesce: remote.quiesce,
		close: remote.close,
	};
}
