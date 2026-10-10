import type { PasswordHasher } from '../../../../platform/security/password-hasher.js';
import { AccountModel } from '../../accounts/model/account-model.js';
import { SessionModel } from '../../sessions/model/session-model.js';
import type { AuthenticatedIdentity, LoginAttempt, PasswordLogin } from '../model/access-types.js';
import { toIdentity } from '../model/access-types.js';
import { LoginFailurePolicy } from './login-failure-policy.js';
import type { LoginFailurePolicyInput } from '../model/login-failure-types.js';
import { AccessFailure } from '../model/access-failure.js';

// Browser cookie is session-only; the old persistent server-side store retains data for 30 days.
const STANDARD_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const REMEMBERED_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

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
	if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value, 'utf8') > 1024) {
		throw new AccessFailure('invalid_input');
	}
}

export class AccessService {
	private readonly dummyHash: Promise<string>;
	private readonly loginFailurePolicy: LoginFailurePolicy;

	constructor(
		private readonly accounts: AccountModel,
		private readonly sessions: SessionModel,
		private readonly hasher: PasswordHasher,
		loginFailureOptions: LoginFailurePolicyInput = { enabled: false },
	) {
		this.dummyHash = hasher.hash('never-used-unknown-account');
		this.loginFailurePolicy = new LoginFailurePolicy(loginFailureOptions);
	}

	needsSetup(): Promise<boolean> {
		return this.accounts.needsSetup();
	}

	async setupAdmin(username: string, password: string): Promise<AuthenticatedIdentity> {
		const validUsername = validateUsername(username);
		validatePassword(password);
		const passwordHash = await this.hasher.hash(password);
		const created = await this.accounts.createInitialAdmin({ username: validUsername, passwordHash });
		if (created === null) {
			throw new AccessFailure('already_initialized');
		}
		return toIdentity(created);
	}

	async login(command: PasswordLogin): Promise<LoginAttempt> {
		const username = validateUsername(command.username);
		if (
			typeof command.password !== 'string' ||
			!command.password ||
			Buffer.byteLength(command.password, 'utf8') > 1024 ||
			typeof command.source !== 'string' ||
			command.source.length > 256
		) {
			throw new AccessFailure('invalid_input');
		}
		const enforceFailurePolicy = this.loginFailurePolicy.shouldEnforce(command.source);
		if (enforceFailurePolicy && !(await this.sessions.checkLoginAdmission(command.source))) {
			return { status: 'rate_limited' };
		}
		const account = await this.accounts.getByUsername(username);
		const verifier = account?.passwordHash ?? (await this.dummyHash);
		const valid = await this.hasher.verify(command.password, verifier);
		if (!valid || account === null) {
			if (enforceFailurePolicy) {
				await this.sessions.recordFailedPassword(command.source, this.loginFailurePolicy.limits);
			}
			return { status: 'invalid_credentials' };
		}
		// TODO(Access later authentication-factors batch): implement real TOTP and
		// Passkey challenge verification before accepting accounts with these flags.
		// Do not downgrade enabled-but-unimplemented factors to password-only login.
		if (account.twoFactorEnabled || account.passkeyRequired) {
			return { status: 'factor_unavailable' };
		}
		const expiresAt = Date.now() + (command.rememberMe ? REMEMBERED_SESSION_MS : STANDARD_SESSION_MS);
		const token = await this.sessions.issue({
			accountId: account.id,
			passwordHash: account.passwordHash,
			previousToken: command.previousToken,
			rememberMe: command.rememberMe,
			expiresAt,
			source: command.source,
			clearLoginAttempts: enforceFailurePolicy,
		});
		if (token === null) {
			return { status: 'invalid_credentials' };
		}
		return {
			status: 'authenticated',
			token,
			identity: toIdentity(account),
			expiresAt,
			rememberMe: command.rememberMe,
		};
	}

	async authenticate(token: string | null): Promise<AuthenticatedIdentity | null> {
		if (token === null || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
			return null;
		}
		const identity = await this.sessions.validate(token, Date.now());
		return identity === null ? null : toIdentity(identity.account);
	}

	async logout(token: string | null): Promise<void> {
		if (token !== null && /^[A-Za-z0-9_-]{43}$/u.test(token)) {
			await this.sessions.revoke(token);
		}
	}

	async changePassword(token: string | null, currentPassword: string, nextPassword: string): Promise<void> {
		const identity = await this.authenticate(token);
		if (!identity) {
			throw new AccessFailure('invalid_credentials');
		}
		validatePassword(nextPassword);
		if (currentPassword === nextPassword) {
			throw new AccessFailure('invalid_input');
		}
		const account = await this.accounts.getById(identity.userId);
		if (!account || !(await this.hasher.verify(currentPassword, account.passwordHash))) {
			throw new AccessFailure('invalid_credentials');
		}
		const hashed = await this.hasher.hash(nextPassword);
		const updated = await this.accounts.changePassword(account.id, account.passwordHash, hashed);
		if (!updated) {
			throw new AccessFailure('conflict');
		}
	}
}
