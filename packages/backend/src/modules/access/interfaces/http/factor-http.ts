import { ACCESS_AUTH_REQUEST_MAX_BYTES } from '@nexus-terminal/shared/access/values';
import { deliverAccessResult } from './access-delivery.js';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { FactorService } from '../../factors/service/factor-service.js';
import type {
	FactorWebauthnOptions,
	FactorPasskeySubmission,
	FactorLoginResult,
} from '../../factors/model/factor-types.js';
import { AccessOperationError, accessBoundary } from '../../access-errors.js';
import {
	InvalidFactorPayload,
	readTotpToken,
	readTotpDisable,
	readPasskeyAuthenticationOptions,
	readPasskeyHasConfigured,
	readPasskeyRegister,
	readPasskeyAuthenticate,
	readPasskeyName,
	type AccessPasskeySummary,
	type AccessPasskeyClientCredential,
	type AccessTotpSetupResponse,
	type AccessTotpChangedResponse,
	type AccessPasskeyVerifiedResponse,
	type AccessPasskeyHasConfiguredResponse,
	type AccessWebauthnOptions,
	type AccessPasskeyRegistrationOptionsResponse,
	type AccessPasskeyAuthenticationOptionsResponse,
	type AccessPasskeyRemoveResponse,
	type AccessPasskeyRenameResponse,
	type AccessTotpLoginResponse,
	type AccessPasskeyLoginResponse,
} from '@nexus-terminal/shared/access/factors/http';
import {
	ACCESS_CHALLENGE_COOKIE_NAME,
	ACCESS_TOTP_SETUP_COOKIE_NAME,
	ACCESS_PARTIAL_COOKIE_NAME,
	ACCESS_SESSION_COOKIE_NAME,
	ACCESS_REMEMBER_SECONDS,
	ACCESS_PARTIAL_SECONDS,
	ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES,
	ACCESS_FACTOR_REQUEST_MAX_BYTES,
	ACCESS_FACTOR_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/access/values';

function sendPasskeyResponse(context: HttpRouteContext, value: unknown, headers?: Record<string, string>): void {
	if (Buffer.byteLength(JSON.stringify(value), 'utf8') > ACCESS_FACTOR_RESPONSE_MAX_BYTES) {
		throw new AccessOperationError('limit_exceeded');
	}
	context.send(200, value, headers);
}

function cookie(name: string, token: string, secure: boolean, maxAge: number): string {
	const attributes = [name + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + maxAge];
	if (secure) {
		attributes.push('Secure');
	}
	return attributes.join('; ');
}

function sessionCookie(token: string, remember: boolean, secure: boolean): string {
	const attributes = [ACCESS_SESSION_COOKIE_NAME + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
	if (remember) {
		attributes.push('Max-Age=' + ACCESS_REMEMBER_SECONDS);
	}
	if (secure) {
		attributes.push('Secure');
	}
	return attributes.join('; ');
}

function factorErrorStatus(code: string): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'unauthenticated':
		case 'invalid_credentials':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'challenge_expired':
			return 410;
		case 'limit_exceeded':
			return 429;
		case 'conflict':
			return 409;
		case 'factor_unavailable':
		case 'storage_unavailable':
		case 'operation_unknown':
		case 'captcha_unavailable':
			return 503;
		default:
			return 500;
	}
}

async function handle(context: HttpRouteContext, work: () => Promise<void>, acceptsQuery = false): Promise<void> {
	try {
		if (!acceptsQuery && context.query.size > 0) {
			throw new InvalidFactorPayload();
		}
		await work();
	} catch (error) {
		if (error instanceof InvalidFactorPayload || error instanceof AccessOperationError) {
			const code = error instanceof InvalidFactorPayload ? 'invalid_input' : error.code;
			context.send(factorErrorStatus(code), { code });
			return;
		}
		// The common HTTP runtime owns unknown failures, body parsing and media-type rejections.
		throw error;
	}
}

/** Strict wire-to-application boundary: every nested field is copied explicitly. */
function toFactorPasskeySubmission(input: AccessPasskeyClientCredential): FactorPasskeySubmission {
	const result: FactorPasskeySubmission = {
		id: input.id,
		rawId: input.rawId,
		type: input.type,
		response: {
			clientDataJSON: input.response.clientDataJSON,
			attestationObject: input.response.attestationObject,
			authenticatorData: input.response.authenticatorData,
			signature: input.response.signature,
			userHandle: input.response.userHandle,
			transports: input.response.transports?.map((transport) => transport),
			publicKeyAlgorithm: input.response.publicKeyAlgorithm,
			publicKey: input.response.publicKey,
		},
		clientExtensionResults: {},
	};
	if (input.authenticatorAttachment !== undefined) {
		result.authenticatorAttachment = input.authenticatorAttachment;
	}
	if (input.clientExtensionResults.credProps !== undefined) {
		result.clientExtensionResults.credProps = { rk: input.clientExtensionResults.credProps.rk };
	}
	return result;
}

async function deliverFactorLogin(
	context: HttpRouteContext,
	factors: FactorService,
	run: () => Promise<FactorLoginResult>,
	secure: boolean,
	passkey: boolean,
): Promise<void> {
	await deliverAccessResult(
		context,
		run,
		(result) => {
			if (result.status !== 'authenticated') {
				context.send(result.status === 'rate_limited' ? 429 : 401, { code: result.status });
				return;
			}
			const user = {
				id: result.identity.id,
				username: result.identity.username,
				twoFactorEnabled: result.identity.twoFactorEnabled,
			};
			const body = passkey
				? ({ verified: true, user } satisfies AccessPasskeyLoginResponse)
				: ({ user } satisfies AccessTotpLoginResponse);
			context.send(200, body, {
				'Set-Cookie': [
					sessionCookie(result.token, result.rememberMe, secure),
					cookie(passkey ? ACCESS_CHALLENGE_COOKIE_NAME : ACCESS_PARTIAL_COOKIE_NAME, '', secure, 0),
				],
			});
		},
		async (result) => {
			if (result.status === 'authenticated') {
				await factors.revokeUndelivered(result.token);
			}
		},
	);
}

/** Project optional WebAuthn fields once; vendor instances never leave the module. */
function assignWebauthnOptionals<T extends AccessWebauthnOptions>(wire: T, options: FactorWebauthnOptions): T {
	if (options.timeout !== undefined) {
		wire.timeout = options.timeout;
	}
	if (options.attestation !== undefined) {
		wire.attestation = options.attestation;
	}
	if (options.userVerification !== undefined) {
		wire.userVerification = options.userVerification;
	}
	if (options.rpId !== undefined) {
		wire.rpId = options.rpId;
	}
	if (options.excludeCredentials !== undefined) {
		wire.excludeCredentials = options.excludeCredentials.map((item) => ({
			type: item.type,
			id: item.id,
			transports: item.transports?.map((transport) => transport),
		}));
	}
	if (options.allowCredentials !== undefined) {
		wire.allowCredentials = options.allowCredentials.map((item) => ({
			type: item.type,
			id: item.id,
			transports: item.transports?.map((transport) => transport),
		}));
	}
	if (options.authenticatorSelection !== undefined) {
		const selection = options.authenticatorSelection;
		wire.authenticatorSelection = {
			residentKey: selection.residentKey,
			userVerification: selection.userVerification,
			authenticatorAttachment: selection.authenticatorAttachment,
			requireResidentKey: selection.requireResidentKey,
		};
	}
	if (options.extensions !== undefined) {
		wire.extensions = { credProps: options.extensions.credProps };
	}
	return wire;
}

function toRegistrationOptions(options: FactorWebauthnOptions): AccessPasskeyRegistrationOptionsResponse {
	if (!options.rp || !options.user || !options.pubKeyCredParams) {
		throw new AccessOperationError('internal_failure');
	}
	return assignWebauthnOptionals(
		{
			challenge: options.challenge,
			rp: { name: options.rp.name, id: options.rp.id },
			user: { id: options.user.id, name: options.user.name, displayName: options.user.displayName },
			pubKeyCredParams: options.pubKeyCredParams.map((item) => ({ type: item.type, alg: item.alg })),
		},
		options,
	);
}

function toAuthenticationOptions(options: FactorWebauthnOptions): AccessPasskeyAuthenticationOptionsResponse {
	return assignWebauthnOptionals({ challenge: options.challenge }, options);
}

export function createFactorRoutes(factors: FactorService, secure: boolean): HttpRoute[] {
	return [
		{
			method: 'POST',
			path: '/api/v1/auth/login/2fa',
			maxBodyBytes: ACCESS_AUTH_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const code = readTotpToken(await context.json());
					await deliverFactorLogin(
						context,
						factors,
						() => factors.loginTotp(context.cookie(ACCESS_PARTIAL_COOKIE_NAME), code, context.sourceIp),
						secure,
						false,
					);
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/2fa/setup',

			handle: (context) =>
				handle(context, async () => {
					await deliverAccessResult(
						context,
						() =>
							factors.totpSetup(
								context.cookie(ACCESS_SESSION_COOKIE_NAME),
								context.cookie(ACCESS_TOTP_SETUP_COOKIE_NAME),
							),
						(result) =>
							context.send(
								200,
								{
									secret: result.secret,
									qrCodeUrl: result.qrCodeUrl,
								} satisfies AccessTotpSetupResponse,
								{
									'Set-Cookie': cookie(
										ACCESS_TOTP_SETUP_COOKIE_NAME,
										result.cookie,
										secure,
										ACCESS_PARTIAL_SECONDS,
									),
								},
							),
						(result) => factors.logoutFlows(null, null, result.cookie),
					);
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/2fa/verify',

			handle: (context) =>
				handle(context, async () => {
					const code = readTotpToken(await context.json());
					await accessBoundary(() =>
						factors.totpActivate(
							context.cookie(ACCESS_SESSION_COOKIE_NAME),
							context.cookie(ACCESS_TOTP_SETUP_COOKIE_NAME),
							code,
						),
					);
					context.send(200, { changed: true } satisfies AccessTotpChangedResponse, {
						'Set-Cookie': cookie(ACCESS_TOTP_SETUP_COOKIE_NAME, '', secure, 0),
					});
				}),
		},
		{
			method: 'DELETE',
			path: '/api/v1/auth/2fa',

			handle: (context) =>
				handle(context, async () => {
					const password = readTotpDisable(await context.json());
					await accessBoundary(() =>
						factors.totpDisable(context.cookie(ACCESS_SESSION_COOKIE_NAME), password),
					);
					context.send(200, { changed: true } satisfies AccessTotpChangedResponse);
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/passkey/registration-options',

			handle: (context) =>
				handle(context, async () => {
					await deliverAccessResult(
						context,
						() =>
							factors.registrationOptions(
								context.cookie(ACCESS_SESSION_COOKIE_NAME),
								context.cookie(ACCESS_CHALLENGE_COOKIE_NAME),
								context.origin,
							),
						(result) =>
							sendPasskeyResponse(context, toRegistrationOptions(result.options), {
								'Set-Cookie': cookie(
									ACCESS_CHALLENGE_COOKIE_NAME,
									result.cookie,
									secure,
									ACCESS_PARTIAL_SECONDS,
								),
							}),
						(result) => factors.logoutFlows(null, result.cookie, null),
					);
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/passkey/register',
			maxBodyBytes: ACCESS_FACTOR_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const response = toFactorPasskeySubmission(readPasskeyRegister(await context.json()));
					const verified = await accessBoundary(() =>
						factors.registerPasskey(
							context.cookie(ACCESS_SESSION_COOKIE_NAME),
							context.cookie(ACCESS_CHALLENGE_COOKIE_NAME),
							response,
						),
					);
					context.send(verified ? 201 : 400, { verified } satisfies AccessPasskeyVerifiedResponse, {
						'Set-Cookie': cookie(ACCESS_CHALLENGE_COOKIE_NAME, '', secure, 0),
					});
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/passkey/authentication-options',

			handle: (context) =>
				handle(context, async () => {
					const username = readPasskeyAuthenticationOptions(await context.json());
					await deliverAccessResult(
						context,
						() =>
							factors.authenticationOptions(
								username,
								context.cookie(ACCESS_CHALLENGE_COOKIE_NAME),
								context.sourceIp,
								context.origin,
							),
						(result) =>
							sendPasskeyResponse(context, toAuthenticationOptions(result.options), {
								'Set-Cookie': cookie(
									ACCESS_CHALLENGE_COOKIE_NAME,
									result.cookie,
									secure,
									ACCESS_PARTIAL_SECONDS,
								),
							}),
						(result) => factors.logoutFlows(null, result.cookie, null),
					);
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/passkey/authenticate',
			maxBodyBytes: ACCESS_FACTOR_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const input = readPasskeyAuthenticate(await context.json());
					const evidence = toFactorPasskeySubmission(input.response);
					await deliverFactorLogin(
						context,
						factors,
						() =>
							factors.authenticatePasskey(
								context.cookie(ACCESS_CHALLENGE_COOKIE_NAME),
								evidence,
								input.rememberMe,
								context.sourceIp,
							),
						secure,
						true,
					);
				}),
		},
		{
			method: 'GET',
			path: '/api/v1/auth/passkey/has-configured',

			handle: (context) =>
				handle(
					context,
					async () => {
						const username = readPasskeyHasConfigured(context.query);
						const hasPasskeys = await accessBoundary(() => factors.hasPasskeys(username));
						context.send(200, { hasPasskeys } satisfies AccessPasskeyHasConfiguredResponse);
					},
					true,
				),
		},
		{
			method: 'GET',
			path: '/api/v1/auth/user/passkeys',

			handle: (context) =>
				handle(context, async () => {
					const credentials = await accessBoundary(() =>
						factors.listPasskeys(context.cookie(ACCESS_SESSION_COOKIE_NAME)),
					);
					sendPasskeyResponse(
						context,
						credentials.map((credential): AccessPasskeySummary => ({
							credentialId: credential.credentialId,
							name: credential.name,
							transports: credential.transports.map((transport) => transport),
							createdAt: Math.floor(credential.createdAt / 1000),
							lastUsedAt:
								credential.lastUsedAt === null ? null : Math.floor(credential.lastUsedAt / 1000),
						})),
					);
				}),
		},
		{
			method: 'DELETE',
			path: '/api/v1/auth/user/passkeys/:credentialID',
			maxPathParameterBytes: ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					await accessBoundary(() =>
						factors.removePasskey(
							context.cookie(ACCESS_SESSION_COOKIE_NAME),
							context.params.credentialID ?? '',
						),
					);
					context.send(200, { removed: true } satisfies AccessPasskeyRemoveResponse);
				}),
		},
		{
			method: 'PUT',
			path: '/api/v1/auth/user/passkeys/:credentialID/name',
			maxPathParameterBytes: ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					const name = readPasskeyName(await context.json());
					await accessBoundary(() =>
						factors.renamePasskey(
							context.cookie(ACCESS_SESSION_COOKIE_NAME),
							context.params.credentialID ?? '',
							name,
						),
					);
					context.send(200, { renamed: true } satisfies AccessPasskeyRenameResponse);
				}),
		},
	];
}
