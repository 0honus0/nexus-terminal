import { ACCESS_PASSWORD_MAX_BYTES } from '@nexus-terminal/shared/access/values';
import {
	ACCESS_PARTIAL_SECONDS,
	ACCESS_REMEMBER_SECONDS,
	ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES,
	ACCESS_PASSKEY_NAME_MAX_BYTES,
} from '@nexus-terminal/shared/access/values';
import type { AccountModel } from '../../accounts/model/account-model.js';
import type { SessionModel } from '../../sessions/model/session-model.js';
import type { SourceAddressModel } from '../../admission/model/source-address-model.js';
import type { LoginFailurePolicy } from '../../login-failure-policy.js';
import { AccessFailure } from '../../access-failure.js';
import type { FactorModel } from '../model/factor-model.js';
import type {
	FactorPasskeySubmission,
	FactorLoginResult,
	StartPartialLogin,
	PartialLoginStartResult,
	FactorPasskeyOptionsIssue,
	FactorTotpSetupIssue,
	FactorPasskeySummary,
	IssuedFactorLogin,
	FactorChallengePolicy,
} from '../model/factor-types.js';

function challengePolicy(): FactorChallengePolicy {
	return {
		expiresAt: Date.now() + ACCESS_PARTIAL_SECONDS * 1000,
		maxChallenges: 1024,
		maxAnonymous: 768,
		maxPerSource: 16,
	};
}

function validCookie(value: string | null): string {
	if (value === null || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
		throw new AccessFailure('unauthenticated');
	}
	return value;
}

function validCode(code: string): void {
	if (typeof code !== 'string' || !/^[0-9]{6}$/u.test(code)) {
		throw new AccessFailure('invalid_input');
	}
}

function validCredentialId(id: string): void {
	if (
		typeof id !== 'string' ||
		id.length === 0 ||
		Buffer.byteLength(id, 'utf8') > ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES
	) {
		throw new AccessFailure('invalid_input');
	}
}

export class FactorService {
	constructor(
		private readonly accounts: AccountModel,
		private readonly sessions: SessionModel,
		private readonly factors: FactorModel,
		private readonly addresses: SourceAddressModel,
		private readonly policy: LoginFailurePolicy,
	) {}

	private async identity(cookie: string) {
		const session = await this.sessions.validate(validCookie(cookie), Date.now());
		if (!session) {
			throw new AccessFailure('unauthenticated');
		}
		if (session.account.id !== 1) {
			throw new AccessFailure('forbidden');
		}
		return session.account;
	}

	private source(value: string) {
		const address = this.addresses.resolve(value);
		if (!address) {
			throw new AccessFailure('invalid_input');
		}
		return { ip: address.ip, enforce: this.policy.shouldEnforce(address.isInternal) };
	}

	logoutFlows(partial: string | null, challenge: string | null, setup: string | null): Promise<void> {
		const token = (value: string | null) => (value !== null && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null);

		return this.factors.revokeFlows(token(partial), token(challenge), token(setup));
	}

	/** Cleanup when the HTTP response became undeliverable after committing a complete login. */
	revokeUndelivered(token: string): Promise<void> {
		return this.sessions.revoke(token);
	}

	startPartial(command: StartPartialLogin): Promise<PartialLoginStartResult> {
		return this.factors.startPartial(
			{
				accountId: command.accountId,
				passwordHash: command.passwordHash,
				rememberMe: command.rememberMe,
				source: command.source,
				enforceFailurePolicy: command.enforceFailurePolicy,
				previousPartial: command.previousPartial,
				signal: command.signal,
			},
			{ expiresAt: Date.now() + ACCESS_PARTIAL_SECONDS * 1000, maxPending: 64 },
		);
	}

	async loginTotp(cookie: string | null, code: string, source: string): Promise<FactorLoginResult> {
		validCode(code);
		const token = validCookie(cookie);
		const ip = this.source(source);
		if (ip.enforce && !(await this.sessions.checkLoginAdmission(ip.ip))) {
			return { status: 'rate_limited' };
		}
		const result = await this.factors.completePartial({
			cookie: token,
			code,
			source: ip.ip,
			enforceFailurePolicy: ip.enforce,
			expiresAt: Date.now() + ACCESS_REMEMBER_SECONDS * 1000,
		});
		if (result.status === 'invalid') {
			if (ip.enforce) {
				await this.sessions.recordFailedPassword(ip.ip, this.policy.limits);
			}
			return { status: 'invalid_credentials' };
		}
		if (result.status === 'stale') {
			return { status: 'unauthenticated' };
		}
		if (result.status === 'rate_limited') {
			return { status: 'rate_limited' };
		}
		return this.completeLogin(result);
	}

	/** A committed session stays owned while its identity is confirmed. */
	private async completeLogin(result: Extract<IssuedFactorLogin, { status: 'issued' }>): Promise<FactorLoginResult> {
		try {
			const identity = await this.sessions.validate(result.token, Date.now());
			if (!identity) {
				throw new AccessFailure('operation_unknown');
			}
			return {
				status: 'authenticated',
				token: result.token,
				identity: {
					id: identity.account.id,
					username: identity.account.username,
					twoFactorEnabled: identity.account.twoFactorEnabled,
				},
				rememberMe: result.rememberMe,
				expiresAt: result.expiresAt,
			};
		} catch (cause) {
			try {
				await this.sessions.revoke(result.token);
			} catch (cleanupError) {
				throw new AccessFailure('operation_unknown', {
					cause: new AggregateError([cause, cleanupError], 'Session confirmation and revocation failed'),
				});
			}
			throw new AccessFailure('operation_unknown', { cause });
		}
	}

	async totpSetup(cookie: string | null, prior: string | null): Promise<FactorTotpSetupIssue> {
		const session = validCookie(cookie);
		const account = await this.identity(session);
		if (account.twoFactorEnabled) {
			throw new AccessFailure('conflict');
		}
		return this.factors.beginTotpSetup({
			accountId: account.id,
			username: account.username,
			session,
			previous: prior,
			policy: challengePolicy(),
		});
	}

	async totpActivate(cookie: string | null, setupCookie: string | null, code: string): Promise<void> {
		validCode(code);
		const session = validCookie(cookie);
		const challenge = validCookie(setupCookie);
		const account = await this.identity(session);
		if (!(await this.factors.finishTotpSetup(account.id, session, challenge, code))) {
			throw new AccessFailure('invalid_credentials');
		}
	}

	async totpDisable(cookie: string | null, password: string): Promise<void> {
		const session = validCookie(cookie);
		const actor = await this.identity(session);
		if (
			typeof password !== 'string' ||
			password.length === 0 ||
			Buffer.byteLength(password, 'utf8') > ACCESS_PASSWORD_MAX_BYTES
		) {
			throw new AccessFailure('invalid_input');
		}
		const account = await this.accounts.getById(actor.id);
		if (!account || !(await this.accounts.verifyPassword(password, account))) {
			throw new AccessFailure('invalid_credentials');
		}
		if (!(await this.factors.disableTotp(account.id, session, account.passwordHash))) {
			throw new AccessFailure('conflict');
		}
	}

	async registrationOptions(
		cookie: string | null,
		prior: string | null,
		origin: string,
	): Promise<FactorPasskeyOptionsIssue> {
		const session = validCookie(cookie);
		const actor = await this.identity(session);
		return this.factors.passkeyRegistrationOptions({
			origin,
			accountId: actor.id,
			username: actor.username,
			session,
			previous: prior,
			policy: challengePolicy(),
		});
	}

	async registerPasskey(
		cookie: string | null,
		challengeCookie: string | null,
		response: FactorPasskeySubmission,
	): Promise<boolean> {
		const session = validCookie(cookie);
		const challenge = validCookie(challengeCookie);
		const actor = await this.identity(session);
		const verified = await this.factors.finishPasskeyRegistration(actor.id, session, challenge, response);
		if (!verified) {
			await this.factors.revokeFlows(null, challenge, null);
		}
		return verified;
	}

	async authenticationOptions(
		username: string | undefined,
		prior: string | null,
		source: string,
		origin: string,
	): Promise<FactorPasskeyOptionsIssue> {
		if (username !== undefined && (typeof username !== 'string' || username.length === 0 || username.length > 64)) {
			throw new AccessFailure('invalid_input');
		}
		const ip = this.source(source);
		if (ip.enforce && !(await this.sessions.checkLoginAdmission(ip.ip))) {
			throw new AccessFailure('limit_exceeded');
		}
		const account = username === undefined ? null : await this.accounts.getByUsername(username);
		return this.factors.passkeyAuthenticationOptions(
			{
				origin,
				accountId: account?.id ?? null,
				previous: prior,
				source: ip.ip,
				restrictToNone: username !== undefined && account === null,
			},
			challengePolicy(),
		);
	}

	async authenticatePasskey(
		challengeCookie: string | null,
		response: FactorPasskeySubmission,
		rememberMe: boolean,
		source: string,
	): Promise<FactorLoginResult> {
		const challenge = validCookie(challengeCookie);
		validCredentialId(response.id);
		const ip = this.source(source);
		if (ip.enforce && !(await this.sessions.checkLoginAdmission(ip.ip))) {
			return { status: 'rate_limited' };
		}
		const result = await this.factors.finishPasskeyAuthentication({
			cookie: challenge,
			expiresAt: Date.now() + ACCESS_REMEMBER_SECONDS * 1000,
			response,
			rememberMe,
			source: ip.ip,
			enforceFailurePolicy: ip.enforce,
		});
		if (result.status === 'stale') {
			await this.factors.revokeFlows(null, challenge, null);
			return { status: 'invalid_credentials' };
		}
		if (result.status === 'invalid') {
			await this.factors.revokeFlows(null, challenge, null);
			if (ip.enforce) {
				await this.sessions.recordFailedPassword(ip.ip, this.policy.limits);
			}
			return { status: 'invalid_credentials' };
		}
		if (result.status === 'rate_limited') {
			return { status: 'rate_limited' };
		}
		return this.completeLogin(result);
	}

	async hasPasskeys(username: string | undefined): Promise<boolean> {
		if (username !== undefined && (typeof username !== 'string' || username.length > 64)) {
			throw new AccessFailure('invalid_input');
		}
		const account = username === undefined ? null : await this.accounts.getByUsername(username);
		return this.factors.hasPasskeys(username === undefined ? null : (account?.id ?? 0));
	}

	async listPasskeys(cookie: string | null): Promise<FactorPasskeySummary[]> {
		const account = await this.identity(validCookie(cookie));
		return (await this.factors.listPasskeys(account.id)).map((credential) => ({
			credentialId: credential.credentialId,
			name: credential.name,
			transports: credential.transports.map((transport) => transport),
			createdAt: credential.createdAt,
			lastUsedAt: credential.lastUsedAt,
		}));
	}

	async renamePasskey(cookie: string | null, id: string, name: string): Promise<void> {
		validCredentialId(id);
		if (
			typeof name !== 'string' ||
			name.trim().length === 0 ||
			Buffer.byteLength(name.trim(), 'utf8') > ACCESS_PASSKEY_NAME_MAX_BYTES
		) {
			throw new AccessFailure('invalid_input');
		}
		const session = validCookie(cookie);
		const account = await this.identity(session);
		if (!(await this.factors.rename(account.id, session, id, name.trim()))) {
			throw new AccessFailure('not_found');
		}
	}

	async removePasskey(cookie: string | null, id: string): Promise<void> {
		validCredentialId(id);
		const session = validCookie(cookie);
		const account = await this.identity(session);
		if (!(await this.factors.delete(account.id, session, id))) {
			throw new AccessFailure('not_found');
		}
	}
}
