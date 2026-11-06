import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_AUTH_REQUEST_MAX_BYTES } from '@nexus-terminal/shared/access/values';
import { deliverAccessResult } from './access-delivery.js';
import { serializeAccessCookie } from './access-cookie.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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
	ACCESS_FACTOR_REQUEST_MAX_BYTES,
	ACCESS_FACTOR_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/access/values';

function sendPasskeyResponse(reply: HttpReply, value: unknown, headers?: Record<string, string>): void {
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		let encoded: string;
		try {
			encoded = JSON.stringify(payload);
		} catch {
			throw new AccessOperationError('internal_failure');
		}
		if (Buffer.byteLength(encoded, 'utf8') > ACCESS_FACTOR_RESPONSE_MAX_BYTES) {
			throw new AccessOperationError('limit_exceeded');
		}
		return encoded;
	});
	reply
		.code(200)
		.headers(headers ?? {})
		.send(value);
}

function factorErrorHandler(error: unknown, _request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof AccessOperationError)) {
		throw error;
	}
	reply.removeHeader('Set-Cookie');
	reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
	const code = error.code;
	reply.code(factorErrorStatus(code)).send({ code });
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

async function handle(
	request: HttpRequest,
	reply: HttpReply,
	work: () => Promise<void>,
	acceptsQuery = false,
): Promise<void> {
	try {
		if (!acceptsQuery && request.query.size > 0) {
			throw new InvalidFactorPayload();
		}
		await work();
	} catch (error) {
		if (error instanceof InvalidFactorPayload || error instanceof AccessOperationError) {
			const code = error instanceof InvalidFactorPayload ? 'invalid_input' : error.code;
			reply.code(factorErrorStatus(code)).send({ code });
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
	request: HttpRequest,
	reply: HttpReply,
	factors: FactorService,
	run: () => Promise<FactorLoginResult>,
	secure: boolean,
	passkey: boolean,
): Promise<void> {
	await deliverAccessResult(
		request,
		reply,
		run,
		(result) => {
			if (result.status !== 'authenticated') {
				reply.code(result.status === 'rate_limited' ? 429 : 401).send({ code: result.status });
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
			reply
				.code(200)
				.headers({
					'Set-Cookie': [
						serializeAccessCookie(reply, ACCESS_SESSION_COOKIE_NAME, result.token, {
							secure,
							maxAge: result.rememberMe ? ACCESS_REMEMBER_SECONDS : undefined,
						}),
						serializeAccessCookie(
							reply,
							passkey ? ACCESS_CHALLENGE_COOKIE_NAME : ACCESS_PARTIAL_COOKIE_NAME,
							'',
							{ secure, maxAge: 0 },
						),
					],
				})
				.send(body);
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
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/login/2fa',
			bodyLimit: ACCESS_AUTH_REQUEST_MAX_BYTES,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const code = readTotpToken(request.body);
					await deliverFactorLogin(
						request,
						reply,
						factors,
						() =>
							factors.loginTotp(
								readRequestCookie(request.raw, ACCESS_PARTIAL_COOKIE_NAME),
								code,
								request.ip,
							),
						secure,
						false,
					);
				}),
		},
		{
			method: 'POST',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/2fa/setup',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					await deliverAccessResult(
						request,
						reply,
						() =>
							factors.totpSetup(
								readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
								readRequestCookie(request.raw, ACCESS_TOTP_SETUP_COOKIE_NAME),
							),
						(result) =>
							reply
								.code(200)
								.headers({
									'Set-Cookie': serializeAccessCookie(
										reply,
										ACCESS_TOTP_SETUP_COOKIE_NAME,
										result.cookie,
										{ secure, maxAge: ACCESS_PARTIAL_SECONDS },
									),
								})
								.send({
									secret: result.secret,
									qrCodeUrl: result.qrCodeUrl,
								} satisfies AccessTotpSetupResponse),
						(result) => factors.logoutFlows(null, null, result.cookie),
					);
				}),
		},
		{
			method: 'POST',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/2fa/verify',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const code = readTotpToken(request.body);
					await accessBoundary(() =>
						factors.totpActivate(
							readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
							readRequestCookie(request.raw, ACCESS_TOTP_SETUP_COOKIE_NAME),
							code,
						),
					);
					reply
						.code(200)
						.headers({
							'Set-Cookie': serializeAccessCookie(reply, ACCESS_TOTP_SETUP_COOKIE_NAME, '', {
								secure,
								maxAge: 0,
							}),
						})
						.send({ changed: true } satisfies AccessTotpChangedResponse);
				}),
		},
		{
			method: 'DELETE',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/2fa',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const password = readTotpDisable(request.body);
					await accessBoundary(() =>
						factors.totpDisable(readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME), password),
					);
					reply.code(200).send({ changed: true } satisfies AccessTotpChangedResponse);
				}),
		},
		{
			method: 'POST',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/passkey/registration-options',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					await deliverAccessResult(
						request,
						reply,
						() =>
							factors.registrationOptions(
								readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
								readRequestCookie(request.raw, ACCESS_CHALLENGE_COOKIE_NAME),
								request.origin,
							),
						(result) =>
							sendPasskeyResponse(reply, toRegistrationOptions(result.options), {
								'Set-Cookie': serializeAccessCookie(
									reply,
									ACCESS_CHALLENGE_COOKIE_NAME,
									result.cookie,
									{ secure, maxAge: ACCESS_PARTIAL_SECONDS },
								),
							}),
						(result) => factors.logoutFlows(null, result.cookie, null),
					);
				}),
		},
		{
			method: 'POST',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/passkey/register',
			bodyLimit: ACCESS_FACTOR_REQUEST_MAX_BYTES,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const response = toFactorPasskeySubmission(readPasskeyRegister(request.body));
					const verified = await accessBoundary(() =>
						factors.registerPasskey(
							readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
							readRequestCookie(request.raw, ACCESS_CHALLENGE_COOKIE_NAME),
							response,
						),
					);
					reply
						.code(verified ? 201 : 400)
						.headers({
							'Set-Cookie': serializeAccessCookie(reply, ACCESS_CHALLENGE_COOKIE_NAME, '', {
								secure,
								maxAge: 0,
							}),
						})
						.send({ verified } satisfies AccessPasskeyVerifiedResponse);
				}),
		},
		{
			method: 'POST',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/passkey/authentication-options',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const username = readPasskeyAuthenticationOptions(request.body);
					await deliverAccessResult(
						request,
						reply,
						() =>
							factors.authenticationOptions(
								username,
								readRequestCookie(request.raw, ACCESS_CHALLENGE_COOKIE_NAME),
								request.ip,
								request.origin,
							),
						(result) =>
							sendPasskeyResponse(reply, toAuthenticationOptions(result.options), {
								'Set-Cookie': serializeAccessCookie(
									reply,
									ACCESS_CHALLENGE_COOKIE_NAME,
									result.cookie,
									{ secure, maxAge: ACCESS_PARTIAL_SECONDS },
								),
							}),
						(result) => factors.logoutFlows(null, result.cookie, null),
					);
				}),
		},
		{
			method: 'POST',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/passkey/authenticate',
			bodyLimit: ACCESS_FACTOR_REQUEST_MAX_BYTES,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const input = readPasskeyAuthenticate(request.body);
					const evidence = toFactorPasskeySubmission(input.response);
					await deliverFactorLogin(
						request,
						reply,
						factors,
						() =>
							factors.authenticatePasskey(
								readRequestCookie(request.raw, ACCESS_CHALLENGE_COOKIE_NAME),
								evidence,
								input.rememberMe,
								request.ip,
							),
						secure,
						true,
					);
				}),
		},
		{
			method: 'GET',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/passkey/has-configured',

			handler: (request, reply) =>
				handle(
					request,
					reply,
					async () => {
						const username = readPasskeyHasConfigured(request.query);
						const hasPasskeys = await accessBoundary(() => factors.hasPasskeys(username));
						reply.code(200).send({ hasPasskeys } satisfies AccessPasskeyHasConfiguredResponse);
					},
					true,
				),
		},
		{
			method: 'GET',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/user/passkeys',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const credentials = await accessBoundary(() =>
						factors.listPasskeys(readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME)),
					);
					sendPasskeyResponse(
						reply,
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
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/user/passkeys/:credentialID',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					await accessBoundary(() =>
						factors.removePasskey(
							readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
							request.params.credentialID ?? '',
						),
					);
					reply.code(200).send({ removed: true } satisfies AccessPasskeyRemoveResponse);
				}),
		},
		{
			method: 'PUT',
			errorHandler: factorErrorHandler,
			url: '/api/v1/auth/user/passkeys/:credentialID/name',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const name = readPasskeyName(request.body);
					await accessBoundary(() =>
						factors.renamePasskey(
							readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
							request.params.credentialID ?? '',
							name,
						),
					);
					reply.code(200).send({ renamed: true } satisfies AccessPasskeyRenameResponse);
				}),
		},
	];
}
