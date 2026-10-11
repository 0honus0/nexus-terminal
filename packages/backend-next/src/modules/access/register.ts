import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { HttpRoute } from '../../platform/http/http-types.js';
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
import type { AuthenticatedIdentity } from './authentication/model/access-types.js';
import { LoginFailurePolicy } from './authentication/service/login-failure-policy.js';
import { SourceAdmissionService } from './admission/service/source-admission.js';
import { CaptchaService } from './captcha/service/captcha-service.js';
import { CaptchaModel } from './captcha/model/captcha-model.js';
import { NetworkCaptchaVerifier } from '../../platform/security/adapters/network-captcha-verifier.js';
import { SecureSessionTokens } from '../../platform/security/adapters/secure-session-tokens.js';
import type { CaptchaConfiguration } from './captcha/model/captcha-types.js';
import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';
import { NativeSourceAddresses } from '../../platform/security/adapters/source-addresses.js';
import { SourceAddressModel } from './admission/model/source-address-model.js';

/** Installation contract; Bootstrap does not depend on private Access types. */
export interface AccessRegistrationOptions {
	sqlite: SqliteRuntime;
	loginFailurePolicy?: {
		enabled: boolean;
		maxAttempts?: number;
		banSeconds?: number;
	};
	/** Installation snapshot until B7 Settings provides the durable policy source. */
	ipWhitelist?: string;
	captcha?: {
		enabled: boolean;
		provider: AccessCaptchaProvider;
		siteKey: string;
		secretKey: string;
		expectedHostname?: string;
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

function toAccessIdentity(identity: AuthenticatedIdentity): AccessIdentity {
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

export function registerAccess({
	sqlite,
	loginFailurePolicy,
	ipWhitelist,
	captcha,
}: AccessRegistrationOptions): RegisteredAccess {
	const tokens = new SecureSessionTokens();
	const addresses = new SourceAddressModel(new NativeSourceAddresses());
	const accounts = new AccountModel(new SqliteAccountStorage(sqlite), new ScryptPasswordHasher(), tokens);
	const sessions = new SessionModel(new SqliteSessionStorage(sqlite), tokens);
	const failurePolicy = new LoginFailurePolicy(toLoginFailurePolicy(loginFailurePolicy));
	const captchaSettings: CaptchaConfiguration = captcha
		? {
				enabled: captcha.enabled,
				provider: captcha.provider,
				siteKey: captcha.siteKey,
				secretKey: captcha.secretKey,
				expectedHostname: captcha.expectedHostname,
			}
		: { enabled: false, provider: 'none', siteKey: '', secretKey: '' };
	const service = new AccessService(
		accounts,
		sessions,
		new CaptchaService(captchaSettings, new CaptchaModel(new NetworkCaptchaVerifier())),
		failurePolicy,
		addresses,
	);
	const admission = new SourceAdmissionService(ipWhitelist ?? '', addresses, sessions, failurePolicy);
	const publicApi: AccessPublicApi = {
		needsSetup: () => accessBoundary(() => service.needsSetup()),

		authenticate: (token) =>
			accessBoundary(async () => {
				const identity = await service.authenticate(token);
				return identity === null ? null : toAccessIdentity(identity);
			}),

		authenticateDigest: (digest) =>
			accessBoundary(async () => {
				const identity = await service.authenticateDigest(digest);
				return identity === null ? null : toAccessIdentity(identity);
			}),

		admitSource: (sourceIp) => accessBoundary(() => admission.admit(sourceIp)),

		admitAuthenticationSource: (sourceIp) => accessBoundary(() => admission.admitAuthenticationSource(sourceIp)),
	};
	return {
		publicApi,

		routes: (secureCookies) => createAccessRoutes(service, secureCookies),
	};
}
