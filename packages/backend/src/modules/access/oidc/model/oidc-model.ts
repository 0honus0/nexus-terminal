import { ACCESS_PARTIAL_SECONDS, ACCESS_REMEMBER_SECONDS } from '@nexus-terminal/shared/access/values';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import {
	OidcProtocolFailure,
	type OidcProtocol,
	type OidcClientConfiguration,
} from '../../../../platform/security/oidc-port.js';
import { accessStorageBoundary } from '../../access-storage-boundary.js';
import { AccessFailure } from '../../access-failure.js';
import type {
	OidcStorage,
	OidcStorageFacts,
	OidcConfigurationRecord,
	OidcFlowRecord,
} from '../storage/oidc-storage.js';
import type {
	OidcSettings,
	OidcSettingsChange,
	OidcConfiguration,
	OidcFacts,
	OidcFlow,
	OidcCallback,
	OidcCompleted,
	OidcStart,
	OidcInstallation,
} from './oidc-types.js';

function validateIssuer(value: string): void {
	let issuer: URL;
	try {
		issuer = new URL(value);
	} catch {
		throw new AccessFailure('invalid_input');
	}
	if (
		(issuer.href !== value && issuer.href !== value + '/') ||
		issuer.search ||
		issuer.hash ||
		issuer.username ||
		issuer.password ||
		(issuer.protocol !== 'https:' &&
			!(issuer.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname)))
	) {
		throw new AccessFailure('invalid_input');
	}
}

function fromFacts(facts: OidcStorageFacts): OidcFacts {
	const c = facts.configuration;
	return {
		configuration:
			c === null
				? null
				: {
						revision: c.revision,
						userId: c.userId,
						label: c.label,
						issuer: c.issuer,
						clientId: c.clientId,
						clientAuthentication: c.clientAuthentication,
						encryptedSecret: c.secretCipher,
						subject: c.subject,
					},
		sessionUserId: facts.sessionUserId,
		account:
			facts.account === null
				? null
				: {
						id: facts.account.id,
						passwordRevision: facts.account.passwordRevision,
						passkeyRequired: facts.account.passkeyRequired,
					},
		blockedUntil: facts.blockedUntil,
	};
}

function toConfiguration(c: OidcConfiguration): OidcConfigurationRecord {
	return {
		revision: c.revision,
		userId: c.userId,
		label: c.label,
		issuer: c.issuer,
		clientId: c.clientId,
		clientAuthentication: c.clientAuthentication,
		secretCipher: c.encryptedSecret,
		subject: c.subject,
	};
}

function requireSession(facts: OidcFacts): number {
	if (facts.sessionUserId === null || facts.account === null || facts.sessionUserId !== facts.account.id) {
		throw new AccessFailure('unauthenticated');
	}
	return facts.sessionUserId;
}

function admitFlow(facts: OidcFacts, flow: OidcFlow, enforceBlock: boolean, signal: AbortSignal): OidcConfiguration {
	if (signal.aborted || flow.expiresAt <= Date.now()) {
		throw new AccessFailure('challenge_expired');
	}
	const c = facts.configuration;
	if (!c || c.revision !== flow.revision) {
		throw new AccessFailure('conflict');
	}
	if (!facts.account || facts.account.passwordRevision !== flow.passwordRevision) {
		throw new AccessFailure('invalid_credentials');
	}
	if (enforceBlock && facts.blockedUntil > Date.now()) {
		throw new AccessFailure('forbidden');
	}
	if (flow.purpose === 'binding') {
		requireSession(facts);
		if (c.subject !== null) {
			throw new AccessFailure('conflict');
		}
	} else if (c.subject === null || facts.account.passkeyRequired) {
		throw new AccessFailure('invalid_credentials');
	}
	return c;
}

export class OidcModel {
	private initialization: Promise<boolean> | null = null;

	constructor(
		private readonly storage: OidcStorage,
		private readonly tokens: SessionTokens,
		private readonly secrets: SecretBox | null,
		private readonly protocol: OidcProtocol,
		private readonly installation: OidcInstallation | null = null,
		private readonly configurationChanged: () => void = () => {},
	) {
		if (installation !== null) {
			validateIssuer(installation.issuer);
			this.secretBox();
			if ((installation.clientAuthentication === 'none') !== (installation.clientSecret === null)) {
				throw new AccessFailure('invalid_input');
			}
		}
	}

	async initialize(): Promise<void> {
		if (this.installation === null) {
			return;
		}
		const task = (this.initialization ??= this.install());
		// An empty instance is retried after administrator setup. Failed/unknown writes
		// keep their rejection for this owner instead of silently replaying the write.
		if (!(await task) && this.initialization === task) {
			this.initialization = null;
		}
	}

	private async install(): Promise<boolean> {
		const input = this.installation;
		if (input === null) {
			return true;
		}
		let installed = false;
		let updating = false;
		try {
			await accessStorageBoundary(() =>
				this.storage.configure(null, (raw) => {
					const facts = fromFacts(raw);
					if (facts.account === null) {
						return null;
					}
					installed = true;
					const previous = facts.configuration;
					const sameIdentity = previous?.issuer === input.issuer && previous.clientId === input.clientId;
					const subject = input.subject ?? (sameIdentity ? previous.subject : null);
					const previousSecret = previous?.encryptedSecret
						? this.secretBox().decrypt(previous.encryptedSecret, 'access:oidc:client-secret')
						: null;
					if (
						sameIdentity &&
						previous.label === input.label &&
						previous.clientAuthentication === input.clientAuthentication &&
						previousSecret === input.clientSecret &&
						previous.subject === subject
					) {
						return null;
					}
					updating = true;
					return toConfiguration({
						revision: this.tokens.issue(),
						userId: facts.account.id,
						label: input.label,
						issuer: input.issuer,
						clientId: input.clientId,
						clientAuthentication: input.clientAuthentication,
						encryptedSecret:
							input.clientSecret === null
								? null
								: this.secretBox().encrypt(input.clientSecret, 'access:oidc:client-secret'),
						subject,
					});
				}),
			);
		} finally {
			if (updating) {
				this.configurationChanged();
			}
		}
		return installed;
	}

	private secretBox(): SecretBox {
		if (this.secrets === null) {
			throw new AccessFailure('factor_unavailable');
		}
		return this.secrets;
	}

	private digest(token: string | null): string | null {
		return token === null ? null : this.tokens.digest(token);
	}

	private async facts(tokenDigest: string | null, source = ''): Promise<OidcFacts> {
		await this.initialize();
		return fromFacts(await accessStorageBoundary(() => this.storage.read(tokenDigest, source)));
	}

	async settings(token: string): Promise<OidcSettings> {
		const facts = await this.facts(this.digest(token));
		requireSession(facts);
		const c = facts.configuration;
		return c === null
			? {
					revision: null,
					label: 'Pocket ID',
					issuer: '',
					clientId: '',
					clientAuthentication: 'client_secret_basic',
					hasSecret: false,
					bound: false,
				}
			: {
					revision: c.revision,
					label: c.label,
					issuer: c.issuer,
					clientId: c.clientId,
					clientAuthentication: c.clientAuthentication,
					hasSecret: c.encryptedSecret !== null,
					bound: c.subject !== null,
				};
	}

	async provider(): Promise<string | null> {
		await this.initialize();
		const provider = await accessStorageBoundary(() => this.storage.readProvider());
		return provider === null ? null : provider.label;
	}

	async save(token: string, input: OidcSettingsChange): Promise<void> {
		await this.initialize();
		validateIssuer(input.issuer);
		const cipher =
			input.secret.action === 'replace'
				? this.secretBox().encrypt(input.secret.value, 'access:oidc:client-secret')
				: null;
		try {
			await accessStorageBoundary(() =>
				this.storage.configure(this.tokens.digest(token), (raw) => {
					const facts = fromFacts(raw);
					const userId = requireSession(facts);
					const previous = facts.configuration;
					if ((previous?.revision ?? null) !== input.revision) {
						throw new AccessFailure('conflict');
					}
					if (
						previous !== null &&
						(previous.issuer !== input.issuer || previous.clientId !== input.clientId) &&
						input.secret.action === 'keep' &&
						previous.encryptedSecret !== null
					) {
						throw new AccessFailure('invalid_input');
					}
					const encryptedSecret =
						input.secret.action === 'keep' ? (previous?.encryptedSecret ?? null) : cipher;
					if (input.clientAuthentication !== 'none' && encryptedSecret === null) {
						throw new AccessFailure('invalid_input');
					}
					if (input.clientAuthentication === 'none' && encryptedSecret !== null) {
						throw new AccessFailure('invalid_input');
					}
					const sameIdentity = previous?.issuer === input.issuer && previous.clientId === input.clientId;
					return toConfiguration({
						revision: this.tokens.issue(),
						userId,
						label: input.label,
						issuer: input.issuer,
						clientId: input.clientId,
						clientAuthentication: input.clientAuthentication,
						encryptedSecret,
						subject: sameIdentity ? previous.subject : null,
					});
				}),
			);
		} finally {
			this.configurationChanged();
		}
	}

	async unbind(token: string, revision: string): Promise<void> {
		await this.initialize();
		try {
			await accessStorageBoundary(() =>
				this.storage.configure(this.tokens.digest(token), (raw) => {
					const facts = fromFacts(raw);
					requireSession(facts);
					const c = facts.configuration;
					if (!c || c.revision !== revision) {
						throw new AccessFailure('conflict');
					}
					return toConfiguration({
						revision: this.tokens.issue(),
						userId: c.userId,
						label: c.label,
						issuer: c.issuer,
						clientId: c.clientId,
						clientAuthentication: c.clientAuthentication,
						encryptedSecret: c.encryptedSecret,
						subject: null,
					});
				}),
			);
		} finally {
			this.configurationChanged();
		}
	}

	private toClient(c: OidcConfiguration): OidcClientConfiguration {
		return {
			issuer: c.issuer,
			clientId: c.clientId,
			clientAuthentication: c.clientAuthentication,
			clientSecret:
				c.encryptedSecret === null
					? null
					: this.secretBox().decrypt(c.encryptedSecret, 'access:oidc:client-secret'),
		};
	}

	private toStoredFlow(flow: OidcFlow): OidcFlowRecord {
		return {
			cookieDigest: flow.cookieDigest,
			revision: flow.revision,
			purpose: flow.purpose,
			sessionDigest: flow.sessionDigest,
			passwordRevision: flow.passwordRevision,
			redirectUri: flow.redirectUri,
			state: flow.state,
			nonce: flow.nonce,
			verifierCipher: this.secretBox().encrypt(flow.verifier, 'access:oidc:verifier:' + flow.cookieDigest),
			rememberMe: flow.rememberMe,
			expiresAt: flow.expiresAt,
		};
	}

	private async protocolCall<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (cause) {
			if (cause instanceof OidcProtocolFailure) {
				throw new AccessFailure(cause.kind === 'rejected' ? 'invalid_credentials' : 'factor_unavailable', {
					cause,
				});
			}
			throw new AccessFailure('factor_unavailable', { cause });
		}
	}

	async start(input: OidcStart): Promise<{ cookie: string; authorizationUrl: string }> {
		const facts = await this.facts(this.digest(input.token), input.source);
		const c = facts.configuration;
		if (!c || !facts.account) {
			throw new AccessFailure('factor_unavailable');
		}
		if (input.purpose === 'binding' && c.revision !== input.revision) {
			throw new AccessFailure('conflict');
		}
		const cookie = this.tokens.issue();
		const flow: OidcFlow = {
			cookieDigest: this.tokens.digest(cookie),
			revision: c.revision,
			purpose: input.purpose,
			sessionDigest: input.purpose === 'binding' ? this.digest(input.token) : null,
			passwordRevision: facts.account.passwordRevision,
			redirectUri: input.redirectUri,
			state: this.tokens.issue(),
			nonce: this.tokens.issue(),
			verifier: this.tokens.issue(),
			rememberMe: input.rememberMe,
			expiresAt: Date.now() + ACCESS_PARTIAL_SECONDS * 1000,
		};
		admitFlow(facts, flow, input.enforceBlock(), input.signal);
		const signal = AbortSignal.any([input.signal, AbortSignal.timeout(ACCESS_PARTIAL_SECONDS * 1000)]);
		const authorizationUrl = await this.protocolCall(() =>
			this.protocol.authorize(
				this.toClient(c),
				{ redirectUri: flow.redirectUri, verifier: flow.verifier, state: flow.state, nonce: flow.nonce },
				signal,
			),
		);
		await accessStorageBoundary(() =>
			this.storage.begin(this.toStoredFlow(flow), this.digest(input.previousCookie), input.source, (raw) => {
				admitFlow(fromFacts(raw), flow, input.enforceBlock(), signal);
			}),
		);
		return { cookie, authorizationUrl };
	}

	async finish(
		cookie: string | null,
		token: string | null,
		redirectUri: string,
		response: OidcCallback,
		source: string,
		enforceBlock: () => boolean,
		signal: AbortSignal,
		purpose: 'login' | 'binding',
	): Promise<OidcCompleted> {
		if (cookie === null) {
			throw new AccessFailure('challenge_expired');
		}
		const stored = await accessStorageBoundary(() =>
			this.storage.consume(this.tokens.digest(cookie), response.state, redirectUri),
		);
		if (!stored) {
			throw new AccessFailure('challenge_expired');
		}
		const flow: OidcFlow = {
			cookieDigest: stored.cookieDigest,
			revision: stored.revision,
			purpose: stored.purpose,
			sessionDigest: stored.sessionDigest,
			passwordRevision: stored.passwordRevision,
			redirectUri: stored.redirectUri,
			state: stored.state,
			nonce: stored.nonce,
			verifier: this.secretBox().decrypt(stored.verifierCipher, 'access:oidc:verifier:' + stored.cookieDigest),
			rememberMe: stored.rememberMe,
			expiresAt: stored.expiresAt,
		};
		if (flow.purpose !== purpose || (flow.purpose === 'binding' && flow.sessionDigest !== this.digest(token))) {
			throw new AccessFailure('invalid_credentials');
		}
		const remaining = flow.expiresAt - Date.now();
		if (remaining <= 0) {
			throw new AccessFailure('challenge_expired');
		}
		const active = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
		const facts = await this.facts(flow.sessionDigest, source);
		const c = admitFlow(facts, flow, enforceBlock(), active);
		const identity = await this.protocolCall(() =>
			this.protocol.verify(
				this.toClient(c),
				{ redirectUri: flow.redirectUri, verifier: flow.verifier, state: flow.state, nonce: flow.nonce },
				{ code: response.code, state: response.state, issuer: response.issuer, error: response.error },
				active,
			),
		);
		const newToken = this.tokens.issue();
		try {
			await accessStorageBoundary(() =>
				this.storage.complete(
					{
						cookieDigest: flow.cookieDigest,
						sessionDigest: flow.sessionDigest,
						rememberMe: flow.rememberMe,
						source,
						tokenDigest: this.tokens.digest(newToken),
						expiresAt: Date.now() + ACCESS_REMEMBER_SECONDS * 1000,
					},
					(raw, claimedExpiresAt) => {
						const current = admitFlow(fromFacts(raw), flow, enforceBlock(), active);
						if (claimedExpiresAt === null || claimedExpiresAt <= Date.now()) {
							throw new AccessFailure('challenge_expired');
						}
						if (
							identity.issuer !== current.issuer ||
							(flow.purpose === 'login' && identity.subject !== current.subject)
						) {
							throw new AccessFailure('invalid_credentials');
						}
						return flow.purpose === 'binding'
							? { purpose: 'binding', subject: identity.subject, revision: this.tokens.issue() }
							: { purpose: 'login' };
					},
				),
			);
		} catch (error) {
			// A failed commit acknowledgement may still have persisted the known bearer.
			if (flow.purpose === 'login') {
				try {
					await accessStorageBoundary(() => this.storage.revokeIssued(this.tokens.digest(newToken)));
				} catch (cleanup) {
					throw new AccessFailure('operation_unknown', {
						cause: new AggregateError([error, cleanup], 'OIDC issuance and revocation failed'),
					});
				}
			}
			throw error;
		} finally {
			if (flow.purpose === 'binding') {
				this.configurationChanged();
			}
		}

		return flow.purpose === 'binding'
			? { purpose: 'binding' }
			: { purpose: 'login', token: newToken, rememberMe: flow.rememberMe };
	}

	discard(cookie: string): Promise<void> {
		return accessStorageBoundary(() => this.storage.discard(this.tokens.digest(cookie)));
	}
}
