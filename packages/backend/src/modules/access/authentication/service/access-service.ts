import { ACCESS_PASSWORD_MAX_BYTES } from '@nexus-terminal/shared/access/values';
import { ACCESS_IP_BLACKLIST_MAX_PAGE_SIZE } from '@nexus-terminal/shared/access/values';
import { AccountModel } from '../../accounts/model/account-model.js';
import { SessionModel } from '../../sessions/model/session-model.js';
import type { AuthenticatedIdentity, LoginAttempt, PasswordLogin, PasswordProof } from '../model/access-types.js';
import type { Account } from '../../accounts/model/account-types.js';
import type { LoginFailurePolicy } from '../../login-failure-policy.js';
import { AccessFailure } from '../../access-failure.js';
import type { CaptchaService } from '../../captcha/service/captcha-service.js';
import type { SourceAddressModel } from '../../admission/model/source-address-model.js';
import type { CaptchaPublicConfiguration } from '../../captcha/model/captcha-types.js';
import type { LoginFailurePage, LoginFailureAdmission } from '../../sessions/model/session-types.js';
import type { FactorService } from '../../factors/service/factor-service.js';

// Browser cookie is session-only; the old persistent server-side store retains data for 30 days.
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function toIdentity(account: Account): AuthenticatedIdentity {
	return { userId: account.id, username: account.username, twoFactorEnabled: account.twoFactorEnabled };
}

function validateUsername(value: string): string {
	if (
		typeof value !== 'string' ||
		value.trim().length < 1 ||
		value.trim().length > 64 ||
		/[\u0000-\u001f\u007f]/u.test(value)
	) {
		throw new AccessFailure('invalid_input');
	}
	return value.trim();
}

function validatePassword(value: string): void {
	if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value, 'utf8') > ACCESS_PASSWORD_MAX_BYTES) {
		throw new AccessFailure('invalid_input');
	}
}

export class AccessService {
	constructor(
		private readonly accounts: AccountModel,
		private readonly sessions: SessionModel,
		private readonly captcha: CaptchaService,
		private readonly loginFailurePolicy: LoginFailurePolicy,
		private readonly addresses: SourceAddressModel,
		private readonly factors: FactorService,
	) {}

	needsSetup(): Promise<boolean> {
		return this.accounts.needsSetup();
	}

	async setupAdmin(username: string, password: string): Promise<AuthenticatedIdentity> {
		const validUsername = validateUsername(username);
		validatePassword(password);
		const passwordHash = await this.accounts.hashPassword(password);
		const created = await this.accounts.createInitialAdmin({ username: validUsername, passwordHash });
		if (created === null) {
			throw new AccessFailure('already_initialized');
		}
		return toIdentity(created);
	}

	async login(command: PasswordLogin): Promise<LoginAttempt> {
		if (command.signal?.aborted) {
			throw new AccessFailure('operation_unknown');
		}
		const username = validateUsername(command.username);
		if (
			typeof command.password !== 'string' ||
			!command.password ||
			Buffer.byteLength(command.password, 'utf8') > ACCESS_PASSWORD_MAX_BYTES ||
			typeof command.source !== 'string' ||
			command.source.length > 256
		) {
			throw new AccessFailure('invalid_input');
		}
		const address = this.addresses.resolve(command.source);
		if (address === null) {
			throw new AccessFailure('invalid_input');
		}
		const source = address.ip;
		const enforceFailurePolicy = this.loginFailurePolicy.shouldEnforce(address.isInternal);
		if (enforceFailurePolicy && !(await this.sessions.checkLoginAdmission(source))) {
			return { status: 'rate_limited' };
		}
		if (command.signal?.aborted) {
			throw new AccessFailure('operation_unknown');
		}
		const captchaValid = await this.captcha.verify(command.captchaToken, source, command.signal);
		if (command.signal?.aborted) {
			throw new AccessFailure('operation_unknown');
		}
		if (!captchaValid) {
			if (enforceFailurePolicy) {
				await this.sessions.recordFailedPassword(source, this.loginFailurePolicy.limits);
			}
			return { status: 'captcha_invalid' };
		}
		if (enforceFailurePolicy && !(await this.sessions.checkLoginAdmission(source))) {
			return { status: 'rate_limited' };
		}
		const account = await this.accounts.getByUsername(username);
		const valid = await this.accounts.verifyPassword(command.password, account);
		if (command.signal?.aborted) {
			throw new AccessFailure('operation_unknown');
		}
		if (!valid || account === null) {
			if (enforceFailurePolicy) {
				await this.sessions.recordFailedPassword(source, this.loginFailurePolicy.limits);
			}
			return { status: 'invalid_credentials' };
		}
		if (account.passkeyRequired) {
			return { status: 'factor_unavailable' };
		}
		if (account.twoFactorEnabled) {
			const pending = await this.factors.startPartial({
				accountId: account.id,
				passwordHash: account.passwordHash,
				rememberMe: command.rememberMe,
				source,
				enforceFailurePolicy,
				previousPartial: command.previousPartialToken ?? null,
				signal: command.signal,
			});
			if (pending.status === 'rate_limited') {
				return { status: 'rate_limited' };
			}
			if (pending.status === 'limit_exceeded') {
				return { status: 'limit_exceeded' };
			}
			if (pending.status === 'cancelled') {
				throw new AccessFailure('operation_unknown');
			}
			if (pending.status !== 'stored') {
				return { status: 'invalid_credentials' };
			}
			return { status: 'requires_two_factor', token: pending.token, expiresAt: pending.expiresAt };
		}
		const expiresAt = Date.now() + SESSION_LIFETIME_MS;
		const issued = await this.sessions.issue({
			accountId: account.id,
			passwordHash: account.passwordHash,
			rememberMe: command.rememberMe,
			expiresAt,
			source,
			clearLoginAttempts: enforceFailurePolicy,
			signal: command.signal,
		});
		if (issued.status === 'cancelled') {
			throw new AccessFailure('operation_unknown');
		}
		if (issued.status === 'rate_limited') {
			return { status: 'rate_limited' };
		}
		if (issued.status === 'credentials_changed') {
			return { status: 'invalid_credentials' };
		}
		return {
			status: 'authenticated',
			token: issued.token,
			identity: toIdentity(account),
			expiresAt,
			rememberMe: command.rememberMe,
		};
	}

	captchaConfig(): CaptchaPublicConfiguration {
		return this.captcha.publicConfig();
	}

	listLoginFailures(token: string | null, limit: number, offset: number): Promise<LoginFailurePage> {
		if (
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > ACCESS_IP_BLACKLIST_MAX_PAGE_SIZE ||
			!Number.isSafeInteger(offset) ||
			offset < 0
		) {
			throw new AccessFailure('invalid_input');
		}
		return this.sessions.listLoginFailures(this.loginFailureAdmission(token), limit, offset);
	}

	clearLoginFailure(token: string | null, source: string): Promise<boolean> {
		const address = this.addresses.resolve(source);
		if (address === null) {
			throw new AccessFailure('invalid_input');
		}
		return this.sessions.clearLoginFailure(address.ip, this.loginFailureAdmission(token));
	}

	private loginFailureAdmission(token: string | null): LoginFailureAdmission {
		if (token === null || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
			throw new AccessFailure('unauthenticated');
		}
		return {
			token,

			admit(identity) {
				if (identity === null) {
					throw new AccessFailure('unauthenticated');
				}
				if (identity.account.id !== 1) {
					throw new AccessFailure('forbidden');
				}
			},
		};
	}

	async authenticate(token: string | null): Promise<AuthenticatedIdentity | null> {
		if (token === null || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
			return null;
		}
		const identity = await this.sessions.validate(token);
		return identity === null ? null : toIdentity(identity.account);
	}

	/** Internal owner check for a preexisting session digest, never a bearer. */
	async authenticateDigest(digest: string): Promise<AuthenticatedIdentity | null> {
		if (!/^[a-f0-9]{64}$/u.test(digest)) {
			return null;
		}
		const identity = await this.sessions.validateDigest(digest);
		return identity === null ? null : toIdentity(identity.account);
	}

	async logout(token: string | null): Promise<void> {
		if (token !== null && /^[A-Za-z0-9_-]{43}$/u.test(token)) {
			await this.sessions.revoke(token);
		}
	}

	async provePassword(token: string | null, password: string): Promise<PasswordProof> {
		const identity = await this.authenticate(token);
		if (!identity || token === null) {
			throw new AccessFailure('unauthenticated');
		}
		if (
			typeof password !== 'string' ||
			!password.length ||
			Buffer.byteLength(password, 'utf8') > ACCESS_PASSWORD_MAX_BYTES
		) {
			throw new AccessFailure('invalid_input');
		}
		const account = await this.accounts.getById(identity.userId);
		if (!account || !(await this.accounts.verifyPassword(password, account))) {
			throw new AccessFailure('invalid_credentials');
		}

		const assertCurrent = async () => {
			if (!(await this.accounts.confirmCredential(account.id, account.passwordHash, token))) {
				throw new AccessFailure('unauthenticated');
			}
		};

		await assertCurrent();
		return { userId: account.id, assertCurrent };
	}

	async changePassword(token: string | null, currentPassword: string, nextPassword: string): Promise<void> {
		const identity = await this.authenticate(token);
		if (!identity || token === null) {
			throw new AccessFailure('unauthenticated');
		}
		if (
			typeof currentPassword !== 'string' ||
			currentPassword.length === 0 ||
			Buffer.byteLength(currentPassword, 'utf8') > ACCESS_PASSWORD_MAX_BYTES
		) {
			throw new AccessFailure('invalid_input');
		}
		validatePassword(nextPassword);
		if (currentPassword === nextPassword) {
			throw new AccessFailure('invalid_input');
		}
		const account = await this.accounts.getById(identity.userId);
		if (!account || !(await this.accounts.verifyPassword(currentPassword, account))) {
			throw new AccessFailure('invalid_credentials');
		}
		const hashed = await this.accounts.hashPassword(nextPassword);
		const updated = await this.accounts.changePassword({
			accountId: account.id,
			expectedHash: account.passwordHash,
			newHash: hashed,
			sessionToken: token,
		});
		if (!updated) {
			throw new AccessFailure('conflict');
		}
	}
}
