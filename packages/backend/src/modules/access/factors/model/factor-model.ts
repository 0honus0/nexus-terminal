import type { SecretBox } from '../../../../platform/security/secret-box.js';
import {
	ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES,
	ACCESS_PASSKEY_MAX_TRANSPORTS,
} from '@nexus-terminal/shared/access/values';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { TotpPort } from '../../../../platform/security/totp-port.js';
import type {
	WebauthnPort,
	WebauthnResponse,
	WebauthnRelyingParty,
	WebauthnRegistrationOptions,
	WebauthnAuthenticationOptions,
} from '../../../../platform/security/webauthn-port.js';
import { WebauthnTechnicalFailure } from '../../../../platform/security/webauthn-port.js';
import { accessStorageBoundary } from '../../access-storage-boundary.js';
import { AccessFailure } from '../../access-failure.js';
import type {
	FactorStorage,
	FactorChallengeRecord,
	PendingLoginRecord,
	PasskeyStorageRecord,
} from '../storage/factor-storage.js';
import type {
	FactorPasskeySite,
	BeginPasskeySetup,
	FactorChallenge,
	PasskeyCredential,
	PendingLogin,
	FactorPasskeySubmission,
	IssuedFactorLogin,
	StartPartialLogin,
	VerifyPasskeyLogin,
	PartialLoginStartResult,
	FactorPasskeyOptionsIssue,
	FactorTotpSetupIssue,
	PasskeyAuthenticationOptionsCommand,
	FactorChallengePolicy,
	BeginFactorSetup,
	CompletePartialLogin,
} from './factor-types.js';
import { toAuthenticationFactorOptions, toRegistrationFactorOptions } from './options-projector.js';

interface NewFactorChallenge {
	policy: FactorChallengePolicy;
	kind: FactorChallenge['kind'];
	accountId: number | null;
	session: string | null;
	oldCookie: string | null;
	challenge: string;
	origin: string | null;
	rpId: string | null;
	restrictToNone?: boolean;
	source?: string;
}

export class FactorModel {
	constructor(
		private readonly storage: Readonly<FactorStorage>,
		private readonly tokens: SessionTokens,
		private readonly secrets: SecretBox | null,
		private readonly totp: TotpPort,
		private readonly webauthn: WebauthnPort,
		private readonly sites: readonly FactorPasskeySite[],
	) {}

	/** Model-owned application-to-technical credential projection. */
	private toTechnologyResponse(input: FactorPasskeySubmission): WebauthnResponse {
		const output: WebauthnResponse = {
			id: input.id,
			rawId: input.rawId,
			type: input.type,
			response: {
				clientDataJSON: input.response.clientDataJSON,
				attestationObject: input.response.attestationObject,
				authenticatorData: input.response.authenticatorData,
				signature: input.response.signature,
				userHandle: input.response.userHandle,
				transports: input.response.transports?.map((value) => value),
				publicKeyAlgorithm: input.response.publicKeyAlgorithm,
				publicKey: input.response.publicKey,
			},
			clientExtensionResults: {
				credProps:
					input.clientExtensionResults.credProps === undefined
						? undefined
						: { rk: input.clientExtensionResults.credProps.rk },
			},
		};
		if (input.authenticatorAttachment !== undefined) {
			output.authenticatorAttachment = input.authenticatorAttachment;
		}
		return output;
	}

	private digest(value: string): string {
		try {
			return this.tokens.digest(value);
		} catch (cause) {
			throw new AccessFailure('internal_failure', { cause });
		}
	}

	private issueToken(): string {
		try {
			return this.tokens.issue();
		} catch (cause) {
			throw new AccessFailure('internal_failure', { cause });
		}
	}

	private toPending(row: PendingLoginRecord): PendingLogin {
		return {
			accountId: row.accountId,
			rememberMe: row.rememberMe,
			expiresAt: row.expiresAt,
		};
	}

	private toChallenge(row: FactorChallengeRecord): FactorChallenge {
		return {
			kind: row.kind,
			accountId: row.accountId,
			sessionDigest: row.sessionDigest,
			sourceIp: row.sourceIp,
			passwordRevision: row.passwordRevision,
			challenge: row.challenge,
			origin: row.origin,
			rpId: row.rpId,
			expiresAt: row.expiresAt,
		};
	}

	private toCredential(row: PasskeyStorageRecord): PasskeyCredential {
		return {
			credentialId: row.credentialId,
			accountId: row.accountId,
			publicKeyBase64: row.publicKeyBase64,
			generation: row.generation,
			counter: row.counter,
			transports: row.transports.map((transport) => transport),
			name: row.name,
			backedUp: row.backedUp,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			lastUsedAt: row.lastUsedAt,
		};
	}

	revokeFlows(partial: string | null, challenge: string | null, setup: string | null): Promise<void> {
		return accessStorageBoundary(() =>
			this.storage.revokeFlows(
				partial === null ? null : this.digest(partial),
				challenge === null ? null : this.digest(challenge),
				setup === null ? null : this.digest(setup),
			),
		);
	}

	private encrypt(accountId: number, secret: string): string {
		if (!this.secrets) {
			throw new AccessFailure('storage_unavailable');
		}
		try {
			return this.secrets.encrypt(secret, 'access:totp:' + accountId);
		} catch (cause) {
			throw new AccessFailure('internal_failure', { cause });
		}
	}

	private decrypt(accountId: number, encrypted: string): string {
		if (!this.secrets) {
			throw new AccessFailure('storage_unavailable');
		}
		try {
			return this.secrets.decrypt(encrypted, 'access:totp:' + accountId);
		} catch (cause) {
			throw new AccessFailure('storage_unavailable', { cause });
		}
	}

	private verifyTotp(secret: string, code: string): boolean {
		try {
			return this.totp.verify(secret, code, Date.now());
		} catch (cause) {
			throw new AccessFailure('internal_failure', { cause });
		}
	}

	private relyingParty(origin: string | null): WebauthnRelyingParty {
		const site = this.sites.find((site) => site.origin === origin);
		if (!site) {
			throw new AccessFailure('factor_unavailable');
		}
		return { origin: site.origin, rpId: site.rpId };
	}

	private async saveChallenge(input: NewFactorChallenge): Promise<string> {
		const token = this.issueToken();
		const challenge: FactorChallengeRecord = {
			kind: input.kind,
			accountId: input.accountId,
			sessionDigest: input.session === null ? null : this.digest(input.session),
			sourceIp: input.source ?? null,
			passwordRevision: input.restrictToNone === true ? 'no-account' : null,
			challenge: input.challenge,
			origin: input.origin,
			rpId: input.rpId,
			expiresAt: input.policy.expiresAt,
		};
		const status = await accessStorageBoundary(() =>
			this.storage.storeChallenge(
				this.digest(token),
				input.oldCookie === null ? null : this.digest(input.oldCookie),
				challenge,
				{
					maxChallenges: input.policy.maxChallenges,
					maxAnonymous: input.policy.maxAnonymous,
					maxPerSource: input.policy.maxPerSource,
				},
			),
		);
		if (status !== 'stored') {
			throw new AccessFailure(status);
		}
		return token;
	}

	async beginTotpSetup(command: BeginFactorSetup): Promise<FactorTotpSetupIssue> {
		const { accountId, username, session, previous, policy } = command;
		let setup: { secret: string; qrCodeUrl: string };
		try {
			setup = await this.totp.generate('NexusTerminal (' + username + ')', 'NexusTerminal');
		} catch (cause) {
			throw new AccessFailure('internal_failure', { cause });
		}
		const encrypted = this.encrypt(accountId, setup.secret);
		const cookie = await this.saveChallenge({
			kind: 'totp_setup',
			accountId,
			session,
			oldCookie: previous,
			challenge: encrypted,
			origin: null,
			rpId: null,
			policy,
		});
		return { cookie, secret: setup.secret, qrCodeUrl: setup.qrCodeUrl };
	}

	async finishTotpSetup(accountId: number, session: string, cookie: string, code: string): Promise<boolean> {
		const stored = await accessStorageBoundary(() =>
			this.storage.findChallenge(this.digest(cookie), 'totp_setup', Date.now),
		);
		const challenge = stored === null ? null : this.toChallenge(stored);
		if (!challenge || challenge.accountId !== accountId || challenge.sessionDigest !== this.digest(session)) {
			return false;
		}
		const secret = this.decrypt(accountId, challenge.challenge);
		if (!this.verifyTotp(secret, code)) {
			return false;
		}
		return accessStorageBoundary(() =>
			this.storage.enableTotp({
				accountId,
				sessionDigest: this.digest(session),
				challengeDigest: this.digest(cookie),
				encrypted: challenge.challenge,
			}),
		);
	}

	async disableTotp(accountId: number, session: string, passwordHash: string): Promise<boolean> {
		const encrypted = await accessStorageBoundary(() => this.storage.getEncryptedTotp(accountId));
		if (!encrypted) {
			return false;
		}
		return accessStorageBoundary(() =>
			this.storage.disableTotp({
				accountId,
				sessionDigest: this.digest(session),
				expectedHash: passwordHash,
				expectedSecret: encrypted,
			}),
		);
	}

	async startPartial(
		command: StartPartialLogin,
		policy: { expiresAt: number; maxPending: number },
	): Promise<PartialLoginStartResult> {
		const token = this.issueToken();
		const expiresAt = policy.expiresAt;
		const previousDigest =
			command.previousPartial !== null && /^[A-Za-z0-9_-]{43}$/u.test(command.previousPartial)
				? this.digest(command.previousPartial)
				: null;
		const status = await accessStorageBoundary(() =>
			this.storage.storePending({
				tokenDigest: this.digest(token),
				accountId: command.accountId,
				passwordHash: command.passwordHash,
				rememberMe: command.rememberMe,
				expiresAt,
				source: command.source,
				enforceBan: command.enforceFailurePolicy,
				maxPending: policy.maxPending,
				previousDigest,
				signal: command.signal,
			}),
		);
		// Expose the committed token even if the transport closes immediately afterwards.
		return { status, token, expiresAt };
	}

	async completePartial(command: CompletePartialLogin): Promise<IssuedFactorLogin> {
		const { cookie, code, source, enforceFailurePolicy: enforce, expiresAt } = command;
		const digest = this.digest(cookie);
		const stored = await accessStorageBoundary(() => this.storage.findPending(digest));
		const pending = stored === null ? null : this.toPending(stored);
		if (!pending) {
			return { status: 'stale' };
		}
		const encrypted = await accessStorageBoundary(() => this.storage.getEncryptedTotp(pending.accountId));
		if (!encrypted) {
			return { status: 'stale' };
		}
		if (!this.verifyTotp(this.decrypt(pending.accountId, encrypted), code)) {
			return { status: 'invalid' };
		}
		const token = this.issueToken();

		const status = await accessStorageBoundary(() =>
			this.storage.completeTotp({
				pendingDigest: digest,
				tokenDigest: this.digest(token),
				expectedEncryptedSecret: encrypted,
				source,
				enforceBan: enforce,
				expiresAt,
			}),
		);
		if (status !== 'issued') {
			return { status };
		}
		return { status: 'issued', token, accountId: pending.accountId, rememberMe: pending.rememberMe, expiresAt };
	}

	async passkeyRegistrationOptions(command: BeginPasskeySetup): Promise<FactorPasskeyOptionsIssue> {
		const { accountId, username, session, previous, policy } = command;
		const rp = this.relyingParty(command.origin);
		const existing = await accessStorageBoundary(() => this.storage.listPasskeys(accountId));
		let options: WebauthnRegistrationOptions;
		try {
			options = await this.webauthn.registrationOptions({
				rp,
				displayName: username,
				relyingPartyName: 'Nexus Terminal',
				userId: String(accountId),
				excluded: existing.map((credential) => ({
					id: credential.credentialId,
					transports: credential.transports.map((transport) => transport),
				})),
			});
		} catch (cause) {
			throw new AccessFailure('factor_unavailable', { cause });
		}
		const projected = toRegistrationFactorOptions(options);
		const cookie = await this.saveChallenge({
			kind: 'passkey_registration',
			accountId,
			session,
			oldCookie: previous,
			challenge: options.challenge,
			origin: rp.origin,
			rpId: rp.rpId,
			policy,
		});
		return { cookie, options: projected };
	}

	async finishPasskeyRegistration(
		accountId: number,
		session: string,
		cookie: string,
		response: FactorPasskeySubmission,
	): Promise<boolean> {
		const digest = this.digest(cookie);
		const stored = await accessStorageBoundary(() =>
			this.storage.findChallenge(digest, 'passkey_registration', Date.now),
		);
		const challenge = stored === null ? null : this.toChallenge(stored);
		if (!challenge || challenge.accountId !== accountId || challenge.sessionDigest !== this.digest(session)) {
			return false;
		}
		if (!this.sites.some((site) => site.origin === challenge.origin && site.rpId === challenge.rpId)) {
			return false;
		}
		const rp = this.relyingParty(challenge.origin);
		let credential;
		try {
			credential = await this.webauthn.registrationVerify({
				rp,
				challenge: challenge.challenge,
				response: this.toTechnologyResponse(response),
			});
		} catch (cause) {
			if (cause instanceof WebauthnTechnicalFailure) {
				throw new AccessFailure('factor_unavailable', { cause });
			}
			throw new AccessFailure('internal_failure', { cause });
		}
		if (!credential) {
			await accessStorageBoundary(() => this.storage.consumeChallenge(digest, 'passkey_registration', Date.now));
			return false;
		}
		if (
			!Number.isSafeInteger(credential.counter) ||
			credential.counter < 0 ||
			credential.id.length > ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES ||
			credential.publicKeyBase64.length > 8192 ||
			credential.transports.length > ACCESS_PASSKEY_MAX_TRANSPORTS
		) {
			return false;
		}
		return accessStorageBoundary(() =>
			this.storage.completeRegistration({
				challengeDigest: digest,
				sessionDigest: this.digest(session),
				accountId,
				credential: {
					credentialId: credential.id,
					publicKeyBase64: credential.publicKeyBase64,
					generation: this.issueToken(),
					counter: credential.counter,
					transports: credential.transports.map((transport) => transport),
					name: null,
					backedUp: credential.backedUp,
				},
			}),
		);
	}

	async passkeyAuthenticationOptions(
		command: PasskeyAuthenticationOptionsCommand,
		policy: FactorChallengePolicy,
	): Promise<FactorPasskeyOptionsIssue> {
		const rp = this.relyingParty(command.origin);
		const accountId = command.accountId;
		const existing = command.restrictToNone
			? []
			: accountId === null
				? null
				: await accessStorageBoundary(() => this.storage.listPasskeys(accountId));
		let options: WebauthnAuthenticationOptions;
		try {
			options = await this.webauthn.authenticationOptions({
				rp,
				allowed:
					existing === null
						? null
						: existing.map((credential) => ({
								id: credential.credentialId,
								transports: credential.transports.map((transport) => transport),
							})),
			});
		} catch (cause) {
			throw new AccessFailure('factor_unavailable', { cause });
		}
		const projected = toAuthenticationFactorOptions(options);
		const cookie = await this.saveChallenge({
			kind: 'passkey_authentication',
			accountId: command.accountId,
			session: null,
			oldCookie: command.previous,
			challenge: options.challenge,
			origin: rp.origin,
			rpId: rp.rpId,
			policy,
			restrictToNone: command.restrictToNone,
			source: command.source,
		});
		return { cookie, options: projected };
	}

	async finishPasskeyAuthentication(command: VerifyPasskeyLogin): Promise<IssuedFactorLogin> {
		const expiresAt = command.expiresAt;
		const digest = this.digest(command.cookie);
		const storedChallenge = await accessStorageBoundary(() =>
			this.storage.findChallenge(digest, 'passkey_authentication', Date.now),
		);
		const challenge = storedChallenge === null ? null : this.toChallenge(storedChallenge);
		if (
			!challenge ||
			!this.sites.some((site) => site.origin === challenge.origin && site.rpId === challenge.rpId)
		) {
			return { status: 'stale' };
		}
		const rp = this.relyingParty(challenge.origin);
		const storedKey = await accessStorageBoundary(() => this.storage.getPasskey(command.response.id));
		const key = storedKey === null ? null : this.toCredential(storedKey);
		if (!key || (challenge.accountId !== null && challenge.accountId !== key.accountId)) {
			return { status: 'invalid' };
		}
		let nextCounter: number | null;
		try {
			nextCounter = await this.webauthn.authenticationVerify({
				rp,
				challenge: challenge.challenge,
				response: this.toTechnologyResponse(command.response),
				key: {
					id: key.credentialId,
					publicKeyBase64: key.publicKeyBase64,
					counter: key.counter,
					transports: key.transports.map((transport) => transport),
				},
			});
		} catch (cause) {
			if (cause instanceof WebauthnTechnicalFailure) {
				throw new AccessFailure('factor_unavailable', { cause });
			}
			throw new AccessFailure('internal_failure', { cause });
		}
		if (nextCounter === null || !Number.isSafeInteger(nextCounter) || nextCounter < 0) {
			await accessStorageBoundary(() =>
				this.storage.consumeChallenge(digest, 'passkey_authentication', Date.now),
			);
			return { status: 'invalid' };
		}
		const token = this.issueToken();

		const status = await accessStorageBoundary(() =>
			this.storage.completePasskeyLogin({
				challengeDigest: digest,
				accountId: key.accountId,
				credentialId: command.response.id,
				expectedGeneration: key.generation,
				expectedCounter: key.counter,
				nextCounter,
				tokenDigest: this.digest(token),
				rememberMe: command.rememberMe,
				source: command.source,
				enforceBan: command.enforceFailurePolicy,
				expiresAt,
			}),
		);
		if (status !== 'issued') {
			return { status };
		}
		return { status: 'issued', token, accountId: key.accountId, rememberMe: command.rememberMe, expiresAt };
	}

	listPasskeys(accountId: number): Promise<PasskeyCredential[]> {
		return accessStorageBoundary(async () =>
			(await this.storage.listPasskeys(accountId)).map((record) => this.toCredential(record)),
		);
	}

	hasPasskeys(accountId: number | null): Promise<boolean> {
		return accessStorageBoundary(() => this.storage.hasPasskeys(accountId));
	}

	rename(accountId: number, session: string, id: string, name: string): Promise<boolean> {
		return accessStorageBoundary(() =>
			this.storage.renamePasskey({
				accountId,
				sessionDigest: this.digest(session),
				credentialId: id,
				name,
			}),
		);
	}

	delete(accountId: number, session: string, id: string): Promise<boolean> {
		return accessStorageBoundary(() =>
			this.storage.deletePasskey({
				accountId,
				sessionDigest: this.digest(session),
				credentialId: id,
			}),
		);
	}
}
