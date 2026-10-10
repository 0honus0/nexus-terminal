import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { HttpRoute } from '../../platform/http/http-server.js';
import { ScryptPasswordHasher } from '../../platform/security/password-hasher.js';
import { SqliteAccountStorage } from './accounts/adapters/sqlite/account-sql.js';
import { AccountModel } from './accounts/model/account-model.js';
import { SqliteSessionStorage } from './sessions/adapters/sqlite/session-sql.js';
import { SessionModel } from './sessions/model/session-model.js';
import { AccessService } from './authentication/service/access-service.js';
import { accessBoundary } from './access-errors.js';
import { createAccessRoutes } from './interfaces/http/access-http.js';
import type { AccessPublicApi, AccessIdentity } from './public.js';
import type { LoginFailurePolicyInput } from './authentication/model/login-failure-types.js';

/** Installation contract; Bootstrap does not depend on private Access types. */
export interface AccessRegistrationOptions {
	sqlite: SqliteRuntime;
	loginFailurePolicy?: {
		enabled: boolean;
		maxAttempts?: number;
		banSeconds?: number;
	};
}

function toLoginFailurePolicy(
	options: AccessRegistrationOptions['loginFailurePolicy'],
): LoginFailurePolicyInput | undefined {
	if (options === undefined) {
		return undefined;
	}
	return {
		enabled: options.enabled,
		maxAttempts: options.maxAttempts,
		banSeconds: options.banSeconds,
	};
}

function toAccessIdentity(identity: { userId: number; username: string; twoFactorEnabled: boolean }): AccessIdentity {
	return {
		userId: identity.userId,
		username: identity.username,
		twoFactorEnabled: identity.twoFactorEnabled,
	};
}

export interface RegisteredAccess {
	publicApi: AccessPublicApi;
	/** Install internally; do not expose Service, password hashes or bearer issuance to other modules. */
	routes(secureCookies: boolean): HttpRoute[];
}

export function registerAccess({ sqlite, loginFailurePolicy }: AccessRegistrationOptions): RegisteredAccess {
	const accounts = new AccountModel(new SqliteAccountStorage(sqlite));
	const sessions = new SessionModel(new SqliteSessionStorage(sqlite));
	const service = new AccessService(
		accounts,
		sessions,
		new ScryptPasswordHasher(),
		toLoginFailurePolicy(loginFailurePolicy),
	);
	const publicApi: AccessPublicApi = {
		needsSetup: () => accessBoundary(() => service.needsSetup()),

		authenticate: (token) =>
			accessBoundary(async () => {
				const identity = await service.authenticate(token);
				return identity === null ? null : toAccessIdentity(identity);
			}),
	};
	return {
		publicApi,

		routes: (secureCookies) => createAccessRoutes(service, secureCookies),
	};
}
